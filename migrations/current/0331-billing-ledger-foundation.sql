-- Foundation repair for billing ledger: admin-only financial access,
-- due_date, discount/tax configuration with dated history, tax exemption,
-- credit application tracking, bill adjustments, immutable-after-issue
-- enforcement, corrected RLS (teachers must not access billing).

-- ============================================================================
-- 1. Add due_date to bills
-- ============================================================================

alter table app_public.bills
  add column due_date date;

comment on column app_public.bills.due_date is 'Date by which the bill should be paid. Nullable for flexibility.';

-- ============================================================================
-- 2. Family discount configuration (dated/effective history)
-- ============================================================================

create table app_public.family_discounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families(id) on delete cascade,
  label text not null,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value integer not null check (discount_value > 0),
  applies_to text not null default 'all' check (applies_to in ('all', 'tuition', 'fees')),
  effective_from date not null,
  effective_until date,
  is_active boolean not null default true,
  created_by uuid not null references app_public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from),
  check (discount_type != 'percentage' or discount_value <= 100)
);

alter table app_public.family_discounts enable row level security;

create index family_discounts_family_active
  on app_public.family_discounts(family_id, is_active)
  where is_active = true;

create trigger _timestamps
  before insert or update on app_public.family_discounts
  for each row execute function app_private.tg__timestamps();

grant select on app_public.family_discounts to :DATABASE_VISITOR;
grant insert, update, delete on app_public.family_discounts to :DATABASE_VISITOR;

comment on table app_public.family_discounts is 'Family-specific discount configuration with dated effective periods. Snapshotted at bill issue time.';
comment on column app_public.family_discounts.discount_type is 'percentage or fixed amount in cents.';
comment on column app_public.family_discounts.discount_value is 'If percentage: percent (1-100). If fixed: cents.';
comment on column app_public.family_discounts.effective_from is 'First date this discount applies.';
comment on column app_public.family_discounts.effective_until is 'Last date this discount applies. Null = ongoing.';

-- ============================================================================
-- 3. Tax rate configuration
-- ============================================================================

create table app_public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  jurisdiction text not null,
  rate_percent integer not null check (rate_percent >= 0 and rate_percent <= 100),
  applies_to text not null default 'all' check (applies_to in ('all', 'tuition', 'fees')),
  effective_from date not null,
  effective_until date,
  is_active boolean not null default true,
  created_by uuid not null references app_public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from)
);

alter table app_public.tax_rates enable row level security;

create index tax_rates_active
  on app_public.tax_rates(is_active)
  where is_active = true;

create trigger _timestamps
  before insert or update on app_public.tax_rates
  for each row execute function app_private.tg__timestamps();

grant select on app_public.tax_rates to :DATABASE_VISITOR;
grant insert, update, delete on app_public.tax_rates to :DATABASE_VISITOR;

comment on table app_public.tax_rates is 'Tax rate definitions with jurisdictional and effective dating. Snapshotted at bill issue time.';

-- ============================================================================
-- 4. Family tax exemptions
-- ============================================================================

create table app_public.family_tax_exemptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families(id) on delete cascade,
  tax_rate_id uuid not null references app_public.tax_rates(id) on delete restrict,
  exemption_reason text not null,
  effective_from date not null,
  effective_until date,
  created_by uuid not null references app_public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (family_id, tax_rate_id)
);

alter table app_public.family_tax_exemptions enable row level security;

create index family_tax_exemptions_family
  on app_public.family_tax_exemptions(family_id);

grant select on app_public.family_tax_exemptions to :DATABASE_VISITOR;
grant insert, update, delete on app_public.family_tax_exemptions to :DATABASE_VISITOR;

comment on table app_public.family_tax_exemptions is 'Per-family exemptions from specific tax rates.';

-- ============================================================================
-- 5. Credit application tracking (which bills consumed which credits)
-- ============================================================================

create table app_public.family_credit_applications (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references app_public.family_credits(id) on delete restrict,
  bill_id uuid not null references app_public.bills(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (credit_id, bill_id)
);

alter table app_public.family_credit_applications enable row level security;

create index fca_credit on app_public.family_credit_applications(credit_id);
create index fca_bill on app_public.family_credit_applications(bill_id);

grant select on app_public.family_credit_applications to :DATABASE_VISITOR;
grant insert on app_public.family_credit_applications to :DATABASE_VISITOR;

comment on table app_public.family_credit_applications is 'Tracks which credits were applied to which bills. Enforces 1:M credit-to-bill relationships.';

-- ============================================================================
-- 6. Bill adjustments (manual adjustments to issued bills)
-- ============================================================================

create table app_public.bill_adjustments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references app_public.bills(id) on delete restrict,
  amount_cents integer not null check (amount_cents <> 0),
  reason text not null,
  created_by uuid not null references app_public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table app_public.bill_adjustments enable row level security;

create index bill_adjustments_bill on app_public.bill_adjustments(bill_id);

grant select on app_public.bill_adjustments to :DATABASE_VISITOR;
grant insert on app_public.bill_adjustments to :DATABASE_VISITOR;

comment on table app_public.bill_adjustments is 'Manual adjustments to a bill after issue. Positive = additional charge, negative = reduction. Immutable once created.';

-- ============================================================================
-- 7. Refund reversal tracking
-- ============================================================================

alter table app_public.refunds
  add column reversed_at timestamptz,
  add column reversed_by uuid references app_public.users(id) on delete set null,
  add column reversal_reason text;

comment on column app_public.refunds.reversed_at is 'When this refund was reversed (if applicable).';
comment on column app_public.refunds.reversed_by is 'Admin who reversed the refund.';
comment on column app_public.refunds.reversal_reason is 'Why the refund was reversed.';

-- ============================================================================
-- 8. Payment immutability constraint
-- ============================================================================

-- Issuing a bill records issued_at in addition to its lifecycle status. The
-- original column grant omitted that timestamp, causing the update to fail
-- before the RLS policy could authorize it.
grant update(status, issued_at, paid_at, cancelled_at, voided_at, notes)
  on app_public.bills to :DATABASE_VISITOR;

alter table app_public.payments
  add constraint payments_immutable_amount_method
    check (amount_cents > 0 and method is not null);

create function app_private.tg_bills__immutable_after_issue() returns trigger as $$
begin
  if OLD.status <> 'draft' and (
    NEW.family_id is distinct from OLD.family_id
    or NEW.bill_number is distinct from OLD.bill_number
    or NEW.billing_period_start is distinct from OLD.billing_period_start
    or NEW.billing_period_end is distinct from OLD.billing_period_end
    or NEW.due_date is distinct from OLD.due_date
    or NEW.subtotal_cents is distinct from OLD.subtotal_cents
    or NEW.discount_cents is distinct from OLD.discount_cents
    or NEW.tax_cents is distinct from OLD.tax_cents
    or NEW.total_cents is distinct from OLD.total_cents
  ) then
    raise exception 'Issued bill amounts and identity are immutable';
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger _billing_immutable_after_issue
  before update on app_public.bills
  for each row execute function app_private.tg_bills__immutable_after_issue();

create function app_private.tg_payments__immutable() returns trigger as $$
begin
  raise exception 'Payments are immutable; record a reversal instead';
end;
$$ language plpgsql;

create trigger _billing_payments_immutable
  before update or delete on app_public.payments
  for each row execute function app_private.tg_payments__immutable();

-- ============================================================================
-- 9. RLS: Admin-only financial access (remove teachers)
-- ============================================================================

-- Drop old policies
drop policy if exists select_bills on app_public.bills;
drop policy if exists insert_bills on app_public.bills;
drop policy if exists update_bills on app_public.bills;
drop policy if exists delete_bills on app_public.bills;

drop policy if exists select_bill_line_items on app_public.bill_line_items;
drop policy if exists insert_bill_line_items on app_public.bill_line_items;
drop policy if exists delete_bill_line_items on app_public.bill_line_items;

drop policy if exists select_payments on app_public.payments;
drop policy if exists insert_payments on app_public.payments;
drop policy if exists update_payments on app_public.payments;
drop policy if exists delete_payments on app_public.payments;

drop policy if exists select_payment_allocations on app_public.payment_allocations;
drop policy if exists insert_payment_allocations on app_public.payment_allocations;
drop policy if exists delete_payment_allocations on app_public.payment_allocations;

drop policy if exists select_family_credits on app_public.family_credits;
drop policy if exists insert_family_credits on app_public.family_credits;
drop policy if exists update_family_credits on app_public.family_credits;
drop policy if exists delete_family_credits on app_public.family_credits;

drop policy if exists select_refunds on app_public.refunds;
drop policy if exists insert_refunds on app_public.refunds;

drop policy if exists select_bill_notifications on app_public.bill_notifications;
drop policy if exists insert_bill_notifications on app_public.bill_notifications;
drop policy if exists update_bill_notifications on app_public.bill_notifications;

drop policy if exists select_financial_audit_events on app_public.financial_audit_events;
drop policy if exists insert_financial_audit_events on app_public.financial_audit_events;

-- Recreate with admin-only access (teachers excluded)

-- bills: admin-only management, family members read-only
create policy select_bills on app_public.bills for select
  using (
    app_public.current_user_role() = 'admin'
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_bills on app_public.bills for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_bills on app_public.bills for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_bills on app_public.bills for delete
  using (app_public.current_user_role() = 'admin');

-- bill_line_items
create policy select_bill_line_items on app_public.bill_line_items for select
  using (
    app_public.current_user_role() = 'admin'
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_bill_line_items on app_public.bill_line_items for insert
  with check (app_public.current_user_role() = 'admin');

create policy delete_bill_line_items on app_public.bill_line_items for delete
  using (app_public.current_user_role() = 'admin');

-- payments
create policy select_payments on app_public.payments for select
  using (
    app_public.current_user_role() = 'admin'
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_payments on app_public.payments for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_payments on app_public.payments for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_payments on app_public.payments for delete
  using (app_public.current_user_role() = 'admin');

-- payment_allocations
create policy select_payment_allocations on app_public.payment_allocations for select
  using (
    app_public.current_user_role() = 'admin'
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
    or payment_id in (
      select id from app_public.payments
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_payment_allocations on app_public.payment_allocations for insert
  with check (app_public.current_user_role() = 'admin');

create policy delete_payment_allocations on app_public.payment_allocations for delete
  using (app_public.current_user_role() = 'admin');

-- family_credits
create policy select_family_credits on app_public.family_credits for select
  using (
    app_public.current_user_role() = 'admin'
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_family_credits on app_public.family_credits for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_family_credits on app_public.family_credits for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_family_credits on app_public.family_credits for delete
  using (app_public.current_user_role() = 'admin');

-- refunds
create policy select_refunds on app_public.refunds for select
  using (
    app_public.current_user_role() = 'admin'
    or payment_id in (
      select id from app_public.payments
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_refunds on app_public.refunds for insert
  with check (app_public.current_user_role() = 'admin');

-- bill_notifications
create policy select_bill_notifications on app_public.bill_notifications for select
  using (
    app_public.current_user_role() = 'admin'
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_bill_notifications on app_public.bill_notifications for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_bill_notifications on app_public.bill_notifications for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

-- financial_audit_events: admin-only (not even teachers)
create policy select_financial_audit_events on app_public.financial_audit_events for select
  using (app_public.current_user_role() = 'admin');

create policy insert_financial_audit_events on app_public.financial_audit_events for insert
  with check (app_public.current_user_role() = 'admin');

-- RLS for new tables

create policy select_family_discounts on app_public.family_discounts for select
  using (
    app_public.current_user_role() = 'admin'
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_family_discounts on app_public.family_discounts for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_family_discounts on app_public.family_discounts for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_family_discounts on app_public.family_discounts for delete
  using (app_public.current_user_role() = 'admin');

create policy select_tax_rates on app_public.tax_rates for select
  using (app_public.current_user_role() in ('admin', 'teacher'));

create policy insert_tax_rates on app_public.tax_rates for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_tax_rates on app_public.tax_rates for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_tax_rates on app_public.tax_rates for delete
  using (app_public.current_user_role() = 'admin');

create policy select_family_tax_exemptions on app_public.family_tax_exemptions for select
  using (
    app_public.current_user_role() = 'admin'
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_family_tax_exemptions on app_public.family_tax_exemptions for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_family_tax_exemptions on app_public.family_tax_exemptions for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_family_tax_exemptions on app_public.family_tax_exemptions for delete
  using (app_public.current_user_role() = 'admin');

create policy select_family_credit_applications on app_public.family_credit_applications for select
  using (
    app_public.current_user_role() = 'admin'
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_family_credit_applications on app_public.family_credit_applications for insert
  with check (app_public.current_user_role() = 'admin');

create policy select_bill_adjustments on app_public.bill_adjustments for select
  using (
    app_public.current_user_role() = 'admin'
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_bill_adjustments on app_public.bill_adjustments for insert
  with check (app_public.current_user_role() = 'admin');
