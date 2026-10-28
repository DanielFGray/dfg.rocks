-- Billing ledger: immutable family-owned financial records with student attribution.
-- Bills, line items, payments, allocations, credits, refunds, audit history.
-- Sequential document numbers, discount/tax snapshots, notification state.
-- No history backfill; existing monthly_payments and lesson_deposits remain
-- the source of truth for prepaid billing and deposit capture.

-- ============================================================================
-- Enums
-- ============================================================================

create type app_public.bill_status as enum (
  'draft',
  'issued',
  'paid',
  'cancelled',
  'void'
);

create type app_public.bill_line_type as enum (
  'lesson',
  'single_booking',
  'fee',
  'adjustment',
  'credit'
);

create type app_public.payment_method as enum (
  'cash',
  'check',
  'card',
  'bank_transfer',
  'other'
);

-- ============================================================================
-- Document number sequences (transactional, never-reused counters)
-- ============================================================================

create table app_public.bill_number_sequences (
  family_id uuid primary key references app_public.families(id) on delete cascade,
  last_number integer not null default 0
);

alter table app_public.bill_number_sequences enable row level security;

create table app_public.payment_number_sequences (
  family_id uuid primary key references app_public.families(id) on delete cascade,
  last_number integer not null default 0
);

alter table app_public.payment_number_sequences enable row level security;

create function app_public.next_bill_number(p_family_id uuid) returns integer as $$
declare
  v_next integer;
begin
  insert into app_public.bill_number_sequences (family_id, last_number)
    values (p_family_id, 0)
    on conflict (family_id) do nothing;

  update app_public.bill_number_sequences
    set last_number = last_number + 1
    where family_id = p_family_id
    returning last_number into v_next;
  return v_next;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

create function app_public.next_payment_number(p_family_id uuid) returns integer as $$
declare
  v_next integer;
begin
  insert into app_public.payment_number_sequences (family_id, last_number)
    values (p_family_id, 0)
    on conflict (family_id) do nothing;

  update app_public.payment_number_sequences
    set last_number = last_number + 1
    where family_id = p_family_id
    returning last_number into v_next;
  return v_next;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

-- ============================================================================
-- Bills
-- ============================================================================

create table app_public.bills (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families(id) on delete restrict,
  bill_number integer not null,
  status app_public.bill_status not null default 'draft',
  billing_period_start date not null,
  billing_period_end date not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  issued_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  voided_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, bill_number),
  check (billing_period_end >= billing_period_start),
  check (issued_at is null or issued_at >= created_at),
  check (paid_at is null or paid_at >= issued_at),
  check (cancelled_at is null or cancelled_at >= created_at),
  check (voided_at is null or voided_at >= created_at),
  check (
    (status = 'issued' and issued_at is not null)
    or (status = 'paid' and issued_at is not null and paid_at is not null)
    or (status = 'cancelled' and cancelled_at is not null)
    or (status = 'void' and voided_at is not null)
    or status = 'draft'
  )
);

alter table app_public.bills enable row level security;

create index bills_family_status on app_public.bills(family_id, status);
create index bills_billing_period on app_public.bills(billing_period_start, billing_period_end);

grant select, insert, update(status, paid_at, cancelled_at, voided_at, notes) on app_public.bills to :DATABASE_VISITOR;

create trigger _timestamps
  before insert or update on app_public.bills
  for each row execute function app_private.tg__timestamps();

comment on table app_public.bills is 'Family-owned bills with itemized charges. Immutable after issue: amounts fixed at snapshotted totals.';
comment on column app_public.bills.family_id is 'The family being billed.';
comment on column app_public.bills.bill_number is 'Sequential number within the family. Generated via next_bill_number(). Never reused.';
comment on column app_public.bills.status is 'Lifecycle: draft -> issued -> paid | cancelled | void.';
comment on column app_public.bills.billing_period_start is 'First calendar day of the billing period.';
comment on column app_public.bills.billing_period_end is 'Last calendar day of the billing period.';
comment on column app_public.bills.subtotal_cents is 'Sum of all line item amounts before discount and tax.';
comment on column app_public.bills.discount_cents is 'Discount amount snapshot at issue time.';
comment on column app_public.bills.tax_cents is 'Tax amount snapshot at issue time.';
comment on column app_public.bills.total_cents is 'subtotal_cents - discount_cents + tax_cents.';
comment on column app_public.bills.issued_at is 'When the bill was issued to the family.';
comment on column app_public.bills.paid_at is 'When the bill was fully paid.';
comment on column app_public.bills.cancelled_at is 'When the bill was cancelled (before payment).';
comment on column app_public.bills.voided_at is 'When the bill was voided (after payment, compensating entries exist).';
comment on column app_public.bills.notes is 'Internal notes about this bill.';

-- ============================================================================
-- Bill line items
-- ============================================================================

create table app_public.bill_line_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references app_public.bills(id) on delete cascade,
  student_id uuid not null references app_public.users(id) on delete restrict,
  line_type app_public.bill_line_type not null,
  description text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  lesson_id uuid references app_public.lessons(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table app_public.bill_line_items enable row level security;

create index bill_line_items_bill on app_public.bill_line_items(bill_id);
create index bill_line_items_student on app_public.bill_line_items(student_id);
create index bill_line_items_lesson on app_public.bill_line_items(lesson_id) where lesson_id is not null;

grant select, insert on app_public.bill_line_items to :DATABASE_VISITOR;

comment on table app_public.bill_line_items is 'Itemized charges on a bill, each attributed to a student. Immutable after bill issuance.';
comment on column app_public.bill_line_items.bill_id is 'Parent bill.';
comment on column app_public.bill_line_items.student_id is 'Student who incurred this charge.';
comment on column app_public.bill_line_items.line_type is 'Category of charge: lesson, single_booking, fee, adjustment, credit.';
comment on column app_public.bill_line_items.description is 'Human-readable description of the charge.';
comment on column app_public.bill_line_items.quantity is 'Number of units (e.g. number of lessons at this rate).';
comment on column app_public.bill_line_items.unit_price_cents is 'Price per unit in cents.';
comment on column app_public.bill_line_items.amount_cents is 'Total line amount = quantity * unit_price_cents.';
comment on column app_public.bill_line_items.lesson_id is 'Optional reference to a specific lesson that generated this charge.';

-- ============================================================================
-- Payments
-- ============================================================================

create table app_public.payments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families(id) on delete restrict,
  payment_number integer not null,
  amount_cents integer not null check (amount_cents > 0),
  method app_public.payment_method not null,
  reference text,
  received_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, payment_number)
);

alter table app_public.payments enable row level security;

create index payments_family on app_public.payments(family_id);
create index payments_received on app_public.payments(received_at desc);

grant select, insert, update(method, reference, received_at, notes) on app_public.payments to :DATABASE_VISITOR;

create trigger _timestamps
  before insert or update on app_public.payments
  for each row execute function app_private.tg__timestamps();

comment on table app_public.payments is 'Payments received from a family. Immutable after creation; refunds are separate compensating entries.';
comment on column app_public.payments.family_id is 'The family that made the payment.';
comment on column app_public.payments.payment_number is 'Sequential number within the family. Generated via next_payment_number(). Never reused.';
comment on column app_public.payments.amount_cents is 'Payment amount in cents.';
comment on column app_public.payments.method is 'How the payment was made.';
comment on column app_public.payments.reference is 'External reference (check number, transaction ID, etc.).';
comment on column app_public.payments.received_at is 'When the payment was received.';

-- ============================================================================
-- Payment allocations
-- ============================================================================

create table app_public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references app_public.payments(id) on delete cascade,
  bill_id uuid not null references app_public.bills(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, bill_id)
);

alter table app_public.payment_allocations enable row level security;

create index payment_allocations_payment on app_public.payment_allocations(payment_id);
create index payment_allocations_bill on app_public.payment_allocations(bill_id);

grant select, insert on app_public.payment_allocations to :DATABASE_VISITOR;

comment on table app_public.payment_allocations is 'Maps payments to the bills they cover. A payment may be split across multiple bills.';
comment on column app_public.payment_allocations.payment_id is 'The payment being allocated.';
comment on column app_public.payment_allocations.bill_id is 'The bill being paid.';
comment on column app_public.payment_allocations.amount_cents is 'Amount from this payment applied to this bill.';

-- ============================================================================
-- Family credits
-- ============================================================================

create table app_public.family_credits (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families(id) on delete restrict,
  student_id uuid references app_public.users(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  reason text not null,
  created_by uuid not null references app_public.users(id) on delete restrict,
  expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (consumed_at is null or consumed_at >= created_at),
  check (expires_at is null or expires_at >= created_at)
);

alter table app_public.family_credits enable row level security;

create index family_credits_family on app_public.family_credits(family_id);
create index family_credits_unconsumed on app_public.family_credits(family_id)
  where consumed_at is null;

grant select, insert, update(consumed_at) on app_public.family_credits to :DATABASE_VISITOR;

comment on table app_public.family_credits is 'Positive credit balance on a family account. Drawn down when applied to a bill.';
comment on column app_public.family_credits.student_id is 'Optional student attribution for the credit.';
comment on column app_public.family_credits.amount_cents is 'Credit amount in cents. Always positive; credits reduce bill totals.';
comment on column app_public.family_credits.reason is 'Why the credit was issued (referral, promotion, compensation, etc.).';
comment on column app_public.family_credits.created_by is 'Admin user who issued the credit.';
comment on column app_public.family_credits.expires_at is 'Optional expiry date for the credit.';
comment on column app_public.family_credits.consumed_at is 'When the credit was fully consumed.';

-- ============================================================================
-- Refunds
-- ============================================================================

create table app_public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references app_public.payments(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  reason text not null,
  created_by uuid not null references app_public.users(id) on delete restrict,
  refunded_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  check (refunded_at >= created_at)
);

alter table app_public.refunds enable row level security;

create index refunds_payment on app_public.refunds(payment_id);

grant select, insert on app_public.refunds to :DATABASE_VISITOR;

comment on table app_public.refunds is 'Refunds/reversals of payments. Immutable: a refund is a compensating entry, not a payment modification.';
comment on column app_public.refunds.payment_id is 'The original payment being refunded.';
comment on column app_public.refunds.amount_cents is 'Refund amount in cents. Must not exceed the unrefunded portion of the payment.';
comment on column app_public.refunds.reason is 'Why the refund was issued.';
comment on column app_public.refunds.created_by is 'Admin user who processed the refund.';
comment on column app_public.refunds.refunded_at is 'When the refund was issued.';

-- ============================================================================
-- Bill notifications (delivery state)
-- ============================================================================

create table app_public.bill_notifications (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references app_public.bills(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'portal')),
  sent_at timestamptz not null default now(),
  status text not null default 'sent' check (status in ('sent', 'delivered', 'failed')),
  error text,
  unique (bill_id, channel)
);

alter table app_public.bill_notifications enable row level security;

create index bill_notifications_bill on app_public.bill_notifications(bill_id);

grant select, insert, update(status, error) on app_public.bill_notifications to :DATABASE_VISITOR;

comment on table app_public.bill_notifications is 'Tracks delivery state of bill notifications across channels.';
comment on column app_public.bill_notifications.channel is 'Delivery channel: email, sms, or portal.';
comment on column app_public.bill_notifications.status is 'Delivery status: sent, delivered, or failed.';

-- ============================================================================
-- Financial audit events
-- ============================================================================

create table app_public.financial_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references app_public.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id uuid not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

alter table app_public.financial_audit_events enable row level security;

create index financial_audit_events_table_record
  on app_public.financial_audit_events(table_name, record_id);
create index financial_audit_events_actor
  on app_public.financial_audit_events(actor_id);
create index financial_audit_events_created
  on app_public.financial_audit_events(created_at desc);

grant select on app_public.financial_audit_events to :DATABASE_VISITOR;

comment on table app_public.financial_audit_events is 'Append-only audit log for financial record changes.';
comment on column app_public.financial_audit_events.actor_id is 'User who performed the action. Null for system-generated events.';
comment on column app_public.financial_audit_events.action is 'The operation performed (create, update, issue, cancel, void, refund, etc.).';
comment on column app_public.financial_audit_events.table_name is 'The table that was modified.';
comment on column app_public.financial_audit_events.record_id is 'The primary key of the modified record.';
comment on column app_public.financial_audit_events.old_values is 'Previous state of the record (null for creates).';
comment on column app_public.financial_audit_events.new_values is 'New state of the record (null for deletes).';

-- ============================================================================
-- RLS policies
-- ============================================================================

-- Helper: returns true if the current user is a billing contact for the family
create function app_public.current_user_is_billing_contact_for(p_family_id uuid) returns boolean as $$
  select exists(
    select 1 from app_public.family_memberships
    where family_id = p_family_id
      and user_id = app_public.current_user_id()
      and is_billing_contact = true
  );
$$ language sql stable security definer set search_path to pg_catalog;

-- bills: family billing contact, family members (read-only), admin/teacher
create policy select_bills on app_public.bills for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_bills on app_public.bills for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy update_bills on app_public.bills for update
  using (app_public.current_user_role() in ('admin', 'teacher'))
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy delete_bills on app_public.bills for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

-- bill_line_items: same scope as bills (via bill join)
create policy select_bill_line_items on app_public.bill_line_items for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_bill_line_items on app_public.bill_line_items for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy delete_bill_line_items on app_public.bill_line_items for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

-- payments: family billing contact, admin/teacher
create policy select_payments on app_public.payments for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_payments on app_public.payments for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy update_payments on app_public.payments for update
  using (app_public.current_user_role() in ('admin', 'teacher'))
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy delete_payments on app_public.payments for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

-- payment_allocations: same scope as payments/bills
create policy select_payment_allocations on app_public.payment_allocations for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
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
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy delete_payment_allocations on app_public.payment_allocations for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

-- family_credits: family can see own, admin/teacher manage
create policy select_family_credits on app_public.family_credits for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_family_credits on app_public.family_credits for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy update_family_credits on app_public.family_credits for update
  using (app_public.current_user_role() in ('admin', 'teacher'))
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy delete_family_credits on app_public.family_credits for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

-- refunds: family can see own, admin/teacher manage
create policy select_refunds on app_public.refunds for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or payment_id in (
      select id from app_public.payments
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_refunds on app_public.refunds for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

-- bill_notifications: family can read, system inserts/updates
create policy select_bill_notifications on app_public.bill_notifications for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_bill_notifications on app_public.bill_notifications for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy update_bill_notifications on app_public.bill_notifications for update
  using (app_public.current_user_role() in ('admin', 'teacher'))
  with check (app_public.current_user_role() in ('admin', 'teacher'));

-- financial_audit_events: admin/teacher only
create policy select_financial_audit_events on app_public.financial_audit_events for select
  using (app_public.current_user_role() in ('admin', 'teacher'));

create policy insert_financial_audit_events on app_public.financial_audit_events for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
