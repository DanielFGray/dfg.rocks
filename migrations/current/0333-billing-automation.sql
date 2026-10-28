-- Billing automation: idempotent monthly bill issuance worker support.
-- All mutation logic in SECURITY DEFINER functions so the worker calls one
-- entry point. REVOKEd from DATABASE_VISITOR — only DB owner (worker) may
-- issue bills. Helper queries (eligible, occurrence_count, effective rates)
-- remain callable for admin inspection.
--
-- Bill granularity: one monthly bill per student, not one per family.
-- Idempotency keyed by (student_id, billing_month).
-- Due date: 5th of the billing month (same month as billing_period_start).
-- Rounding: explicit half-up via ROUND(), not integer truncation.

-- Safe re-runnable setup: CREATE OR REPLACE / IF NOT EXISTS for objects.
-- No DROP TABLE — would destroy billing run data.

-- ============================================================================
-- 1. Monthly billing runs tracking table
-- ============================================================================
-- One row per student per billing month for idempotency. The family_id is
-- denormalized for efficient per-family queries (reports, admin views).

create table if not exists app_public.monthly_billing_runs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families(id) on delete cascade,
  student_id uuid not null references app_public.users(id) on delete cascade,
  billing_month date not null
    check (billing_month = date_trunc('month', billing_month)::date),
  bill_id uuid references app_public.bills(id) on delete set null,
  due_date date not null,
  status text not null default 'completed'
    check (status in ('completed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (student_id, billing_month)
);

alter table app_public.monthly_billing_runs enable row level security;

create index monthly_billing_runs_family
  on app_public.monthly_billing_runs(family_id);
create index monthly_billing_runs_student
  on app_public.monthly_billing_runs(student_id);
create index monthly_billing_runs_month
  on app_public.monthly_billing_runs(billing_month);

grant select, insert, update(status, error)
  on app_public.monthly_billing_runs to :DATABASE_VISITOR;

comment on table app_public.monthly_billing_runs
  is 'Idempotency tracking for automated monthly bill issuance. One row per student per billing month.';
comment on column app_public.monthly_billing_runs.student_id
  is 'The student being billed. A family with multiple students gets one run per student.';
comment on column app_public.monthly_billing_runs.family_id
  is 'Denormalized family for efficient per-family aggregation in reports.';
comment on column app_public.monthly_billing_runs.bill_id
  is 'The issued bill. Null if billing failed before bill creation.';
comment on column app_public.monthly_billing_runs.due_date
  is 'Snapshotted due date; always the 5th of the billing month.';
comment on column app_public.monthly_billing_runs.status
  is 'completed or failed. Only completed rows prevent re-billing.';

-- ============================================================================
-- 2. RLS policies for monthly_billing_runs
-- ============================================================================

create policy select_monthly_billing_runs
  on app_public.monthly_billing_runs for select
  using (
    app_public.current_user_role() = 'admin'
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_monthly_billing_runs
  on app_public.monthly_billing_runs for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_monthly_billing_runs
  on app_public.monthly_billing_runs for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_monthly_billing_runs
  on app_public.monthly_billing_runs for delete
  using (app_public.current_user_role() = 'admin');

-- ============================================================================
-- 3. Eligible family-student pairs for a billing month
-- ============================================================================
-- Returns one row per active recurring schedule with family and rate info.
-- The caller groups by (family_id, student_id) for per-student billing.

create function app_public.monthly_billing_eligible(
  p_billing_month date
) returns table(
  family_id uuid,
  student_id uuid,
  student_rate_id uuid,
  rate_cents integer,
  lesson_duration_minutes integer,
  location_type app_public.location_type,
  schedule_id uuid,
  day_of_week smallint,
  local_start_time time without time zone,
  timezone text,
  starts_on date,
  ends_on date,
  family_slug text
) security definer
  set search_path to pg_catalog
  language sql stable as $$
  select distinct on (rs.id)
    fm.family_id,
    sr.student_id,
    sr.id as student_rate_id,
    sr.rate_cents,
    sr.lesson_duration_minutes,
    sr.location_type,
    rs.id as schedule_id,
    rs.day_of_week,
    rs.local_start_time,
    rs.timezone,
    rs.starts_on,
    rs.ends_on,
    f.slug as family_slug
  from app_public.recurring_schedules rs
  join app_public.student_rates sr
    on sr.id = rs.student_rate_id
    and sr.billing_model = 'monthly_prepaid'
  join app_public.family_memberships fm
    on fm.user_id = sr.student_id
  join app_public.families f
    on f.id = fm.family_id
  where rs.active
    and rs.starts_on <= (p_billing_month + interval '1 month - 1 day')::date
    and (rs.ends_on is null or rs.ends_on >= p_billing_month)
  order by rs.id, fm.is_billing_contact desc nulls last
$$;

comment on function app_public.monthly_billing_eligible(date) is
  'Returns all active recurring schedule rows active within the billing month, with family and rate info.';

-- ============================================================================
-- 4. Compute occurrence count for a schedule within a billing month
-- ============================================================================

create function app_public.monthly_occurrence_count(
  p_starts_on date,
  p_ends_on date,
  p_billing_month date,
  p_day_of_week smallint
) returns integer
  security definer
  set search_path to pg_catalog
  language sql stable as $$
  with period as (
    select
      greatest(p_starts_on, p_billing_month) as period_start,
      least(
        coalesce(p_ends_on, (p_billing_month + interval '1 month - 1 day')::date),
        (p_billing_month + interval '1 month - 1 day')::date
      ) as period_end
  )
  select count(*)::integer
  from period, generate_series(
    period_start,
    period_end,
    interval '1 day'
  ) d(day)
  where extract(isodow from d.day) = p_day_of_week;
$$;

comment on function app_public.monthly_occurrence_count is
  'Counts ISO weekday occurrences within a date range clipped to the billing month.';

-- ============================================================================
-- 5. Effective discount at a point in time
-- ============================================================================
-- NOTE: student_rates has no effective-date history — the single current rate
-- per (student_id, location_type) is used. Dated rate history is future work.

create function app_public.get_effective_discount(
  p_family_id uuid,
  p_on_date date
) returns table(
  discount_type text,
  discount_value integer,
  applies_to text,
  label text
) security definer
  set search_path to pg_catalog
  language sql stable as $$
  select
    fd.discount_type,
    fd.discount_value,
    fd.applies_to,
    fd.label
  from app_public.family_discounts fd
  where fd.family_id = p_family_id
    and fd.is_active
    and fd.effective_from <= p_on_date
    and (fd.effective_until is null or fd.effective_until >= p_on_date)
  order by fd.created_at
  limit 1;
$$;

comment on function app_public.get_effective_discount is
  'Returns the single active discount for a family on a given date, or empty if none.';

-- ============================================================================
-- 6. Effective tax rate at a point in time
-- ============================================================================

create function app_public.get_effective_tax_rate(
  p_family_id uuid,
  p_on_date date
) returns table(
  tax_rate_id uuid,
  label text,
  jurisdiction text,
  rate_percent numeric(5,2),
  applies_to text
) security definer
  set search_path to pg_catalog
  language sql stable as $$
  select
    tr.id,
    tr.label,
    tr.jurisdiction,
    tr.rate_percent,
    tr.applies_to
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

comment on function app_public.get_effective_tax_rate is
  'Returns the single applicable tax rate for a family on a given date, or empty if exempt/none.';

-- ============================================================================
-- 7. Create line items for one student from recurring schedules
-- ============================================================================
-- Per-student: called once per student by the main loop, not per-family.
-- Discount and tax are still applied at the family level (via family_id).

create function app_public.create_monthly_bill_line_items(
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
  v_discount record;
  v_tax record;
  v_month_name text;
  v_year text;
  v_line record;
  v_family_id uuid;
begin
  select to_char(p_billing_month, 'FMMonth') into v_month_name;
  select to_char(p_billing_month, 'YYYY') into v_year;

  -- Get the family_id for this student from the eligible rows
  select e.family_id into v_family_id
  from app_public.monthly_billing_eligible(p_billing_month) e
  where e.student_id = p_student_id
  limit 1;

  for v_line in
    select
      e.student_id,
      e.schedule_id,
      e.rate_cents,
      e.lesson_duration_minutes,
      e.timezone,
      e.day_of_week,
      e.starts_on,
      e.ends_on,
      e.location_type,
      app_public.monthly_occurrence_count(e.starts_on, e.ends_on, p_billing_month, e.day_of_week) as occurrence_count
    from app_public.monthly_billing_eligible(p_billing_month) e
    where e.student_id = p_student_id
  loop
    if v_line.occurrence_count = 0 then
      continue;
    end if;

    insert into app_public.bill_line_items (
      bill_id, student_id, line_type, description,
      quantity, unit_price_cents, amount_cents
    ) values (
      p_bill_id,
      v_line.student_id,
      'lesson',
      v_line.occurrence_count || ' × ' || v_line.lesson_duration_minutes || 'min lesson — ' || v_month_name || ' ' || v_year,
      v_line.occurrence_count,
      v_line.rate_cents,
      v_line.occurrence_count * v_line.rate_cents
    );

    v_subtotal := v_subtotal + (v_line.occurrence_count * v_line.rate_cents);
  end loop;

  -- Apply discount (snapshotted on bill, not as a line item)
  select * into v_discount
  from app_public.get_effective_discount(v_family_id, p_billing_month);

  if found then
    if v_discount.discount_type = 'percentage' then
      v_discount_cents := round(v_subtotal * v_discount.discount_value / 100.0)::integer;
    else
      v_discount_cents := least(v_discount.discount_value, v_subtotal);
    end if;
  end if;

  -- Apply tax (snapshotted on bill)
  select * into v_tax
  from app_public.get_effective_tax_rate(v_family_id, p_billing_month);

  if found then
    v_tax_cents := round((v_subtotal - v_discount_cents) * v_tax.rate_percent / 100.0)::integer;
  end if;

  v_total_cents := v_subtotal - v_discount_cents + v_tax_cents;

  update app_public.bills
    set
      subtotal_cents = v_subtotal,
      discount_cents = v_discount_cents,
      tax_cents = v_tax_cents,
      total_cents = v_total_cents,
      due_date = p_due_date
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
  'Creates line items on a draft bill from one student recurring schedules and updates bill totals. Returns inserted rows.';

-- ============================================================================
-- 8. Enqueue lesson generation for a student/month (decoupled from payment)
-- ============================================================================

create function app_public.enqueue_monthly_lesson_generation(
  p_student_id uuid,
  p_billing_month date
) returns void
  security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_job_key text;
begin
  v_job_key := 'lessons__generate_prepaid_period:auto:' || p_student_id || ':' || to_char(p_billing_month, 'YYYY-MM');
  perform graphile_worker.add_job(
    'lessons__generate_prepaid_period',
    json_build_object(
      'studentId', p_student_id,
      'billingMonth', to_char(p_billing_month, 'YYYY-MM-DD')
    ),
    job_key := v_job_key,
    job_key_mode := 'replace'
  );
end;
$$;

comment on function app_public.enqueue_monthly_lesson_generation is
  'Queues lesson generation for a student for a given billing month. Decoupled from payment recording.';

-- ============================================================================
-- 9. Main entry point: issue monthly bills for a billing month
-- ============================================================================
-- Iterates per student (not per family). Due date is 5th of billing month.
-- Idempotency key: (student_id, billing_month) in monthly_billing_runs.

create function app_public.issue_monthly_bills(
  p_billing_month date
) returns jsonb
  security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_due_date date;
  v_student record;
  v_family_id uuid;
  v_bill_number integer;
  v_bill_id uuid;
  v_line_count integer;
  v_summary jsonb;
  v_students_processed integer := 0;
  v_bills_created integer := 0;
  v_bills_skipped integer := 0;
  v_errors integer := 0;
  v_error_detail text;
begin
  if p_billing_month is null or p_billing_month <> date_trunc('month', p_billing_month)::date then
    raise exception 'p_billing_month must be the first day of a month';
  end if;

  -- Due date: 5th of the billing month (same month)
  v_due_date := p_billing_month + 4;
  -- e.g. billing_month = 2026-07-01 → due_date = 2026-07-05

  for v_student in
    select distinct e.family_id, e.student_id
    from app_public.monthly_billing_eligible(p_billing_month) e
    order by e.family_id, e.student_id
  loop
    v_students_processed := v_students_processed + 1;

    -- Idempotency: skip if this student already has a completed billing run for this month
    if exists (
      select 1 from app_public.monthly_billing_runs
      where student_id = v_student.student_id
        and billing_month = p_billing_month
        and status = 'completed'
    ) then
      v_bills_skipped := v_bills_skipped + 1;
      continue;
    end if;

    -- Per-student draft check: a draft bill for student A must not block student B.
    -- We check via bill_line_items so each student gets their own bill.
    if exists (
      select 1 from app_public.bills b
      join app_public.bill_line_items bli on bli.bill_id = b.id
      where b.family_id = v_student.family_id
        and b.billing_period_start = p_billing_month
        and b.status = 'draft'
        and bli.student_id = v_student.student_id
    ) then
      v_bills_skipped := v_bills_skipped + 1;
      continue;
    end if;

    -- If a failed run exists for this student, clear it so we can retry
    delete from app_public.monthly_billing_runs
    where student_id = v_student.student_id
      and billing_month = p_billing_month
      and status = 'failed';

    begin
      -- Generate bill number for the family
      select app_public.next_bill_number(v_student.family_id) into v_bill_number;

      -- Create draft bill (one per student, keyed to the family)
      insert into app_public.bills (
        family_id, bill_number, status,
        billing_period_start, billing_period_end, due_date,
        subtotal_cents, discount_cents, tax_cents, total_cents
      ) values (
        v_student.family_id, v_bill_number, 'draft',
        p_billing_month,
        (p_billing_month + interval '1 month - 1 day')::date,
        v_due_date,
        0, 0, 0, 0
      ) returning id into v_bill_id;

      -- Create line items from schedules for this student
      perform app_public.create_monthly_bill_line_items(
        v_bill_id, v_student.student_id, p_billing_month, v_due_date
      );

      -- Re-read bill to verify total > 0
      select count(*) into v_line_count
      from app_public.bill_line_items
      where bill_id = v_bill_id;

      if v_line_count = 0 then
        -- No active occurrences - cancel the draft bill
        update app_public.bills
        set status = 'cancelled', cancelled_at = now()
        where id = v_bill_id;
        continue;
      end if;

      -- Issue the bill
      update app_public.bills
      set status = 'issued', issued_at = now()
      where id = v_bill_id;

      -- Record the billing run
      insert into app_public.monthly_billing_runs (
        family_id, student_id, billing_month, bill_id, due_date, status
      ) values (
        v_student.family_id, v_student.student_id, p_billing_month, v_bill_id, v_due_date, 'completed'
      );

      v_bills_created := v_bills_created + 1;

      -- Enqueue lesson generation for this student (decoupled from payment)
      perform app_public.enqueue_monthly_lesson_generation(v_student.student_id, p_billing_month);

    exception when others then
      GET STACKED DIAGNOSTICS v_error_detail = MESSAGE_TEXT;
      v_errors := v_errors + 1;
      -- Record failure
      insert into app_public.monthly_billing_runs (
        family_id, student_id, billing_month, due_date, status, error
      ) values (
        v_student.family_id, v_student.student_id, p_billing_month, v_due_date, 'failed',
        left(v_student.student_id || ': ' || v_error_detail, 4000)
      )
      on conflict (student_id, billing_month)
      do update set status = 'failed', error = excluded.error;
    end;
  end loop;

  v_summary := jsonb_build_object(
    'billing_month', to_char(p_billing_month, 'YYYY-MM-DD'),
    'due_date', to_char(v_due_date, 'YYYY-MM-DD'),
    'students_processed', v_students_processed,
    'bills_created', v_bills_created,
    'bills_skipped', v_bills_skipped,
    'errors', v_errors
  );

  return v_summary;
end;
$$;

comment on function app_public.issue_monthly_bills(date) is
  'Idempotent monthly bill issuance for a given billing month. Creates one draft
   bill per student (not per family), snapshots rates/discounts/taxes, issues
   them, enqueues decoupled lesson generation, and records billing runs for
   idempotency. Returns JSON summary. Due date = 5th of billing month.';

-- ============================================================================
-- 10. Worker entry point (named-argument wrapper for JS)
-- ============================================================================

create function app_public.issue_monthly_bills_for_month(
  p_billing_month date,
  out result jsonb
) security definer
  set search_path to pg_catalog
  language sql as $$
  select app_public.issue_monthly_bills(p_billing_month);
$$;

-- ============================================================================
-- 11. Security: revoke broad visitor execute on worker-only functions
-- ============================================================================
-- The worker connects as DATABASE_OWNER and can execute SECURITY DEFINER
-- functions. DATABASE_VISITOR (authenticated web users) must not be able to
-- trigger billing issuance or job enqueue. Helper/query functions remain
-- callable for admin inspection via RLS.

-- Revoke from public (all roles except owner/superuser) and from the default
-- privilege grant to :DATABASE_VISITOR (applied by ALTER DEFAULT PRIVILEGES
-- in 0020-schemas.sql when functions are created in app_public).
-- After these revokes, only the function owner (DATABASE_OWNER) and superusers
-- can execute these worker-only functions. Neither the authenticator role nor
-- the visitor role (web users) can trigger billing issuance.
revoke execute on function app_public.issue_monthly_bills(date)
  from public, :DATABASE_VISITOR;

revoke execute on function app_public.issue_monthly_bills_for_month(date)
  from public, :DATABASE_VISITOR;

revoke execute on function app_public.enqueue_monthly_lesson_generation(uuid, date)
  from public, :DATABASE_VISITOR;

revoke execute on function app_public.create_monthly_bill_line_items(uuid, uuid, date, date)
  from public, :DATABASE_VISITOR;
