-- Billing rate history, discount/tax snapshots, and security hardening.

-- ============================================================================
-- 1. Discount/tax snapshot details on bills
-- ============================================================================
-- Persist the full configuration (type, value, rate, exemption identity) on
-- the bill — not just aggregate cents — for audit completeness.

alter table app_public.bills
  add column if not exists discount_details jsonb,
  add column if not exists tax_details jsonb;

comment on column app_public.bills.discount_details is
  'Snapshot of discount configuration at issue time: {label, discount_type, discount_value, applies_to}. Null if no discount was applied.';
comment on column app_public.bills.tax_details is
  'Snapshot of tax configuration at issue time: {label, jurisdiction, rate_percent, applies_to, tax_rate_id, exemption_id}. Null if no tax was applied.';

-- ============================================================================
-- 2. Student rate history (effective-dated)
-- ============================================================================
-- Records the rate that was in effect for a student at any point in time.
-- Populated automatically whenever a new row is inserted into student_rates.
-- The billing function uses this history to compute the correct rate for the
-- billing month, rather than silently using whatever rate happens to be
-- current when the worker runs.
--
-- NOTE: Only forward-looking history is captured (insert trigger). Old data
-- is not backfilled. Billing periods before this migration use the rate
-- that was current when billing ran, which is the best we can do without
-- manual entry of historical rate changes.

create table if not exists app_public.student_rate_history (
  id uuid primary key default gen_random_uuid(),
  student_rate_id uuid not null references app_public.student_rates(id) on delete cascade,
  student_id uuid not null references app_public.users(id) on delete cascade,
  rate_cents integer not null check (rate_cents >= 0),
  lesson_duration_minutes integer not null check (lesson_duration_minutes in (30, 60)),
  location_type app_public.location_type not null,
  billing_model app_public.billing_model not null,
  effective_from date not null,
  effective_until date,
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from)
);

alter table app_public.student_rate_history enable row level security;

create index if not exists srh_student_period
  on app_public.student_rate_history(student_id, effective_from);
create index if not exists srh_rate_id
  on app_public.student_rate_history(student_rate_id);

grant select on app_public.student_rate_history to :DATABASE_VISITOR;

comment on table app_public.student_rate_history is
  'Effective-dated record of student rate changes. Populated by trigger on student_rates INSERT.';

create policy select_student_rate_history on app_public.student_rate_history for select
  using (app_public.current_user_role() = 'admin');

-- Seed history for existing student_rates
insert into app_public.student_rate_history (
  student_rate_id, student_id, rate_cents, lesson_duration_minutes,
  location_type, billing_model, effective_from
)
select id, student_id, rate_cents, lesson_duration_minutes,
       location_type, billing_model, created_at::date
from app_public.student_rates
on conflict do nothing;

-- Trigger: record the effective value whenever a rate is inserted or changed.
-- The admin upsert updates the existing student_rates row, so an insert-only
-- trigger would silently keep billing at the original rate forever.
create or replace function app_private.tg_student_rates__record_history()
returns trigger
  security definer
  set search_path to pg_catalog
  language plpgsql as $$
begin
  if TG_OP = 'UPDATE' then
    delete from app_public.student_rate_history
     where student_rate_id = NEW.id
       and effective_from = current_date;

    update app_public.student_rate_history
       set effective_until = current_date - 1
     where student_rate_id = NEW.id
       and effective_until is null
       and effective_from < current_date;
  end if;

  insert into app_public.student_rate_history (
    student_rate_id, student_id, rate_cents, lesson_duration_minutes,
    location_type, billing_model, effective_from
  ) values (
    NEW.id, NEW.student_id, NEW.rate_cents, NEW.lesson_duration_minutes,
    NEW.location_type, NEW.billing_model, current_date
  );
  return NEW;
end;
$$;

drop trigger if exists _record_history on app_public.student_rates;
create trigger _record_history
  after insert or update on app_public.student_rates
  for each row execute function app_private.tg_student_rates__record_history();

-- ============================================================================
-- 3. Drop old functions before recreating with new return types
-- ============================================================================
-- Must DROP before CREATE because the return type changes from record to jsonb.
-- Drops are safe in a transaction: 0333 has no DROP TABLE with CASCADE that
-- would propagate, and graphile-migrate runs each file in its own transaction.

drop function if exists app_public.create_monthly_bill_line_items(uuid, uuid, date, date);
drop function if exists app_public.get_effective_discount(uuid, date);
drop function if exists app_public.get_effective_tax_rate(uuid, date);

-- ============================================================================
-- 4. Updated helper functions — return jsonb snapshots (not records)
-- ============================================================================

create or replace function app_public.get_effective_discount(
  p_family_id uuid,
  p_on_date date
) returns jsonb
  security definer
  set search_path to pg_catalog
  language sql stable as $$
  select jsonb_build_object(
    'label', fd.label,
    'discount_type', fd.discount_type,
    'discount_value', fd.discount_value,
    'applies_to', fd.applies_to
  )
  from app_public.family_discounts fd
  where fd.family_id = p_family_id
    and fd.is_active
    and fd.effective_from <= p_on_date
    and (fd.effective_until is null or fd.effective_until >= p_on_date)
  order by fd.created_at
  limit 1;
$$;

create or replace function app_public.get_effective_tax_rate(
  p_family_id uuid,
  p_on_date date
) returns jsonb
  security definer
  set search_path to pg_catalog
  language sql stable as $$
  select jsonb_build_object(
    'tax_rate_id', tr.id,
    'label', tr.label,
    'jurisdiction', tr.jurisdiction,
    'rate_percent', tr.rate_percent,
    'applies_to', tr.applies_to,
    'exemption_id', null::uuid
  )
  from app_public.tax_rates tr
  where tr.is_active
    and tr.effective_from <= p_on_date
    and (tr.effective_until is null or tr.effective_until >= p_on_date)
    and not exists (
      select 1 from app_public.family_tax_exemptions fte
      where fte.family_id = p_family_id
        and fte.tax_rate_id = tr.id
        and fte.effective_from <= p_on_date
        and (fte.effective_until is null or fte.effective_until >= p_on_date)
    )
  order by tr.created_at
  limit 1;
$$;

-- ============================================================================
-- 5. Updated create_monthly_bill_line_items
--    — uses rate history for the billing month
--    — populates discount_details and tax_details on bills
-- ============================================================================

create or replace function app_public.create_monthly_bill_line_items(
  p_bill_id uuid,
  p_student_id uuid,
  p_billing_month date,
  p_due_date date
) returns table(
  student_id uuid,
  line_type text,
  description text,
  quantity integer,
  unit_price_cents integer,
  amount_cents integer,
  schedule_id uuid
) security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_subtotal integer := 0;
  v_discount_cents integer := 0;
  v_tax_cents integer := 0;
  v_total_cents integer := 0;
  v_discount jsonb;
  v_tax jsonb;
  v_month_name text;
  v_year text;
  v_line record;
  v_family_id uuid;
  v_effective_rate_cents integer;
  v_line_tax integer;
begin
  select to_char(p_billing_month, 'FMMonth') into v_month_name;
  select to_char(p_billing_month, 'YYYY') into v_year;

  select e.family_id into v_family_id
  from app_public.monthly_billing_eligible(p_billing_month) e
  where e.student_id = p_student_id
  limit 1;

  -- Expand occurrences before selecting rate history. A rate change in the
  -- middle of a month must affect only the lessons on or after its effective
  -- date, rather than retroactively pricing the whole billing period.
  for v_line in
    select
      occurrences.student_id,
      occurrences.schedule_id,
      occurrences.effective_rate_cents as rate_cents,
      occurrences.lesson_duration_minutes,
      occurrences.location_type,
      count(*)::integer as occurrence_count
    from (
      select
        e.student_id,
        e.schedule_id,
        coalesce(rate.lesson_duration_minutes, e.lesson_duration_minutes) as lesson_duration_minutes,
        coalesce(rate.location_type, e.location_type) as location_type,
        coalesce(
          rate.rate_cents,
          e.rate_cents
        ) as effective_rate_cents
      from app_public.monthly_billing_eligible(p_billing_month) e
      cross join lateral generate_series(
        greatest(e.starts_on, p_billing_month),
        least(
          coalesce(e.ends_on, (p_billing_month + interval '1 month - 1 day')::date),
          (p_billing_month + interval '1 month - 1 day')::date
        ),
        interval '1 day'
      ) as occurrence_dates(occurrence_date)
      left join lateral (
        select srh.rate_cents, srh.lesson_duration_minutes, srh.location_type
        from app_public.student_rate_history srh
        where srh.student_rate_id = e.student_rate_id
          and srh.effective_from <= occurrence_dates.occurrence_date::date
          and (srh.effective_until is null or srh.effective_until >= occurrence_dates.occurrence_date::date)
        order by srh.effective_from desc
        limit 1
      ) rate on true
      where e.student_id = p_student_id
        and extract(isodow from occurrence_dates.occurrence_date)::smallint = e.day_of_week
    ) occurrences
    group by occurrences.student_id, occurrences.schedule_id,
      occurrences.effective_rate_cents, occurrences.lesson_duration_minutes,
      occurrences.location_type
    order by occurrences.schedule_id, occurrences.effective_rate_cents
  loop
    if v_line.occurrence_count = 0 then
      continue;
    end if;

    v_effective_rate_cents := v_line.rate_cents;

    insert into app_public.bill_line_items (
      bill_id, student_id, line_type, description,
      quantity, unit_price_cents, amount_cents
    ) values (
      p_bill_id,
      v_line.student_id,
      'lesson',
      v_line.occurrence_count || ' × ' || v_line.lesson_duration_minutes || 'min lesson — ' || v_month_name || ' ' || v_year,
       v_line.occurrence_count,
      v_effective_rate_cents,
      v_line.occurrence_count * v_effective_rate_cents
    );

    v_subtotal := v_subtotal + (v_line.occurrence_count * v_effective_rate_cents);
  end loop;

  -- Apply discount (snapshotted as jsonb on bill)
  v_discount := app_public.get_effective_discount(v_family_id, p_billing_month);
  if v_discount is not null and (v_discount->>'applies_to') in ('all', 'tuition') then
    if (v_discount->>'discount_type') = 'percentage' then
      v_discount_cents := round(v_subtotal * (v_discount->>'discount_value')::numeric / 100.0)::integer;
    else
      v_discount_cents := least((v_discount->>'discount_value')::integer, v_subtotal);
    end if;
  end if;

  -- Apply tax (snapshotted as jsonb on bill)
  v_tax := app_public.get_effective_tax_rate(v_family_id, p_billing_month);
  if v_tax is not null and (v_tax->>'applies_to') in ('all', 'tuition') then
    -- Tax is rounded per line after the line's discount, as required by the
    -- billing rules. Fixed discounts are applied to the bill aggregate.
    if v_discount is not null and (v_discount->>'discount_type') = 'percentage' then
      for v_line in
        select bli.amount_cents
          from app_public.bill_line_items bli
         where bli.bill_id = p_bill_id
      loop
        v_line_tax := round(
          (v_line.amount_cents - round(v_line.amount_cents * (v_discount->>'discount_value')::numeric / 100.0))
          * (v_tax->>'rate_percent')::numeric / 100.0
        )::integer;
        v_tax_cents := v_tax_cents + v_line_tax;
      end loop;
    else
      -- Fixed discounts are allocated proportionally before rounding each
      -- taxable line, so aggregate tax cannot change with line grouping.
      for v_line in
        select bli.amount_cents,
               case when v_subtotal = 0 then 0
                    else round(bli.amount_cents * v_discount_cents::numeric / v_subtotal)::integer
               end as line_discount
          from app_public.bill_line_items bli
         where bli.bill_id = p_bill_id
      loop
        v_line_tax := round(
          (v_line.amount_cents - v_line.line_discount)
          * (v_tax->>'rate_percent')::numeric / 100.0
        )::integer;
        v_tax_cents := v_tax_cents + v_line_tax;
      end loop;
    end if;
  end if;

  v_total_cents := v_subtotal - v_discount_cents + v_tax_cents;

  update app_public.bills
    set
      subtotal_cents = v_subtotal,
      discount_cents = v_discount_cents,
      tax_cents = v_tax_cents,
      total_cents = v_total_cents,
      due_date = p_due_date,
      discount_details = v_discount,
      tax_details = v_tax
    where id = p_bill_id;

  return query
  select
    bli.student_id,
    bli.line_type::text,
    bli.description,
    bli.quantity,
    bli.unit_price_cents,
    bli.amount_cents,
    null::uuid
  from app_public.bill_line_items bli
  where bli.bill_id = p_bill_id;
end;
$$;

comment on function app_public.create_monthly_bill_line_items is
  'Creates line items from recurring schedules for one student, using effective-dated rate history. Populates discount/tax snapshot details on the bill.';

-- ============================================================================
-- 6. Security: revoke execute on billing SECURITY DEFINER functions
-- ============================================================================
-- 0333 already revokes mutation entrypoints; this adds the remaining billing
-- SECURITY DEFINER functions so no visitor/parent/teacher can invoke them.

-- next_bill_number and next_payment_number are SECURITY DEFINER helpers
-- called from within withAuthContext (visitor role); they must remain
-- executable. current_user_is_billing_contact_for is unused in active RLS
-- but kept callable for potential policy use.
--
-- Worker entrypoints already revoked in 0333. Revoke query helpers below
-- — these are called internally by SECURITY DEFINER functions, never
-- directly by visitors.

revoke execute on function app_public.monthly_billing_eligible(date)
  from public, :DATABASE_VISITOR;

revoke execute on function app_public.monthly_occurrence_count(date, date, date, smallint)
  from public, :DATABASE_VISITOR;

revoke execute on function app_public.get_effective_discount(uuid, date)
  from public, :DATABASE_VISITOR;

revoke execute on function app_public.get_effective_tax_rate(uuid, date)
  from public, :DATABASE_VISITOR;
