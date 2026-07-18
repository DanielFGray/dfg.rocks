create table app_public.recurring_schedules (
  id uuid primary key default gen_random_uuid(),
  student_rate_id uuid not null
    references app_public.student_rates(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  local_start_time time without time zone not null,
  timezone text not null default 'America/Chicago',
  starts_on date not null,
  ends_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

create index recurring_schedules_student_rate
  on app_public.recurring_schedules(student_rate_id);
create index recurring_schedules_active_bounds
  on app_public.recurring_schedules(starts_on, ends_on)
  where active;

create trigger _timestamps
  before insert or update on app_public.recurring_schedules
  for each row execute function app_private.tg__timestamps();

create table app_public.monthly_payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  billing_month date not null
    check (billing_month = date_trunc('month', billing_month)::date),
  amount_cents integer not null check (amount_cents > 0),
  paid_at timestamptz not null default now(),
  notes text,
  generation_status text not null default 'pending'
    check (generation_status in ('pending', 'processing', 'generated', 'failed')),
  generation_error text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, billing_month)
);

create index monthly_payments_billing_month
  on app_public.monthly_payments(billing_month);

create trigger _timestamps
  before insert or update on app_public.monthly_payments
  for each row execute function app_private.tg__timestamps();

alter table app_public.lessons
  add column recurring_schedule_id uuid
    references app_public.recurring_schedules(id),
  add column recurrence_date date,
  add constraint lessons_recurrence_provenance_complete check (
    (recurring_schedule_id is null) = (recurrence_date is null)
  );

alter table app_public.lessons
  add constraint lessons_recurring_occurrence_unique
    unique (recurring_schedule_id, recurrence_date);

create index lessons_recurring_schedule
  on app_public.lessons(recurring_schedule_id)
  where recurring_schedule_id is not null;

alter table app_public.recurring_schedules enable row level security;

create policy select_own on app_public.recurring_schedules for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_rate_id in (
      select id
      from app_public.student_rates
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );

create policy insert_admin on app_public.recurring_schedules for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.recurring_schedules for update
  using (app_public.current_user_role() in ('admin', 'teacher'))
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.recurring_schedules for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update, delete on app_public.recurring_schedules to :DATABASE_VISITOR;

alter table app_public.monthly_payments enable row level security;

create policy select_own on app_public.monthly_payments for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_admin on app_public.monthly_payments for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.monthly_payments for update
  using (app_public.current_user_role() in ('admin', 'teacher'))
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.monthly_payments for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update, delete on app_public.monthly_payments to :DATABASE_VISITOR;

create function app_public.enqueue_prepaid_lesson_generation(payment_id uuid)
returns void as $$
begin
  if app_public.current_user_role() not in ('admin', 'teacher') then
    raise insufficient_privilege using message = 'Only admins and teachers may enqueue lesson generation';
  end if;

  perform graphile_worker.add_job(
    'lessons__generate_prepaid_period',
    json_build_object('paymentId', payment_id),
    job_key := 'lessons__generate_prepaid_period:' || payment_id::text,
    job_key_mode := 'replace'
  );
end;
$$ language plpgsql volatile security definer
set search_path to pg_catalog, public, pg_temp;

grant execute on function app_public.enqueue_prepaid_lesson_generation(uuid)
  to :DATABASE_VISITOR;

comment on table app_public.recurring_schedules is
  'Standing weekly lesson slots. The referenced student rate supplies student, duration, and location.';
comment on column app_public.recurring_schedules.day_of_week is
  'ISO weekday, Monday = 1 through Sunday = 7.';
comment on column app_public.recurring_schedules.local_start_time is
  'Wall-clock lesson start time in the schedule timezone.';
comment on table app_public.monthly_payments is
  'Monthly prepaid payment records and their lesson-generation state.';
comment on column app_public.monthly_payments.billing_month is
  'First calendar day of the paid month.';
comment on column app_public.monthly_payments.amount_cents is
  'Amount received, in cents.';
comment on column app_public.lessons.recurring_schedule_id is
  'Standing schedule that generated this individual lesson occurrence.';
comment on column app_public.lessons.recurrence_date is
  'Local calendar date of this recurring lesson occurrence.';
