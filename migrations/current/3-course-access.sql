/*
 * One rule decides who may read a course and everything in it (modules, module_materials,
 * and materials embedded in a module). A reader gets in by an enrollment, by an active
 * weekly lesson schedule, or by a live subscription of their payer.
 *
 * Every statement here reruns safely: `graphile-migrate watch` applies this file after
 * each edit, and the release commit applies it again on a database that already has it.
 */

-- Subscriptions -------------------------------------------------------------------------

create table if not exists app_public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  payer_id uuid not null references app_public.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  status text not null,
  price_id text not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  -- Stripe's `created` time of the event that wrote this row. Stripe does not order deliveries, so
  -- the webhook overwrites a row only when this value is not newer than the event's time.
  stripe_event_created timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_payer_id on app_public.subscriptions(payer_id);

drop trigger if exists _timestamps on app_public.subscriptions;
create trigger _timestamps
  before insert or update on app_public.subscriptions
  for each row execute function app_private.tg__timestamps();

comment on table app_public.subscriptions is
  E'A Stripe subscription paid by a payer. Written by the Stripe webhook as the root role; the visitor reads only its own payer''s rows.';

alter table app_public.subscriptions enable row level security;

drop policy if exists select_visible on app_public.subscriptions;
create policy select_visible on app_public.subscriptions for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or payer_id in (select app_public.current_user_visible_payer_ids())
  );

grant select on app_public.subscriptions to :DATABASE_VISITOR;

-- Schedule time zones ---------------------------------------------------------------------

-- can_read_course converts "now" into each schedule's zone, so one unknown zone would make every
-- course read fail for everyone. Refuse unknown zones when a schedule is written, and refuse the
-- migration while an existing schedule already holds one.
do $$
declare
  v_bad text;
begin
  select string_agg(id::text, ', ') into v_bad
    from app_public.recurring_schedules
   where timezone not in (select name from pg_timezone_names);
  if v_bad is not null then
    raise exception 'Recurring schedules have a time zone PostgreSQL does not know: %', v_bad;
  end if;
end;
$$;

create or replace function app_private.tg_recurring_schedules__timezone() returns trigger as $$
begin
  if not exists (select 1 from pg_timezone_names where name = NEW.timezone) then
    raise exception 'Time zone "%" is not a known IANA time zone', NEW.timezone using errcode = 'DNIED';
  end if;
  return NEW;
end;
$$ language plpgsql set search_path to pg_catalog, pg_temp;

drop trigger if exists _timezone on app_public.recurring_schedules;
create trigger _timezone
  before insert or update of timezone on app_public.recurring_schedules
  for each row execute function app_private.tg_recurring_schedules__timezone();

-- The access rule ------------------------------------------------------------------------

-- The four course-access policies depend on the one-argument function, so they are dropped
-- before it, and recreated below against the two-argument version.
drop policy if exists select_enrolled on app_public.courses;
drop policy if exists select_via_course on app_public.modules;
drop policy if exists select_via_module on app_public.module_materials;
drop policy if exists select_accessible on app_public.materials;

drop function if exists app_public.can_read_course(uuid);

create or replace function app_public.can_read_course(
  p_course_id uuid,
  p_reader_id uuid default app_public.current_user_id()
) returns boolean as $$
  with
  -- The learners a reader sees: the reader, and when the reader is a parent, the students in
  -- every family the parent belongs to. A sibling is not a learner of the reader's enrollment.
  learners as (
    select p_reader_id as user_id
    union
    select fm2.user_id
      from app_public.family_memberships fm1
      join app_public.family_memberships fm2 on fm2.family_id = fm1.family_id
      join app_public.users u on u.id = fm2.user_id
     where fm1.user_id = p_reader_id
       and u.role = 'student'
       and exists (
         select 1 from app_public.users r where r.id = p_reader_id and r.role = 'parent'
       )
  ),
  -- The reader and the billing contact of every family the reader belongs to.
  payers as (
    select p_reader_id as user_id
    union
    select fm.user_id
      from app_public.family_memberships fm
     where fm.is_billing_contact
       and fm.family_id in (
         select family_id from app_public.family_memberships where user_id = p_reader_id
       )
  )
  select
    -- Another user's access is reported only to staff and to members of a family the reader
    -- belongs to, so an unrelated account cannot probe it.
    (p_reader_id = app_public.current_user_id()
     or app_public.current_user_role() in ('admin', 'teacher')
     or p_reader_id in (
       select fm.user_id
         from app_public.family_memberships fm
        where fm.family_id in (select app_public.current_user_member_family_ids())
     ))
    and (
      exists (
        select 1 from app_public.users u
         where u.id = p_reader_id and u.role in ('admin', 'teacher')
      )
      or exists (
        select 1
          from app_public.enrollments e
         where e.course_id = p_course_id
           and e.student_id in (select user_id from learners)
      )
      or exists (
        select 1
          from app_public.recurring_schedules rs
          join app_public.student_rates sr on sr.id = rs.student_rate_id
         where rs.active
           and rs.starts_on <= (now() at time zone rs.timezone)::date
           and (rs.ends_on is null or rs.ends_on >= (now() at time zone rs.timezone)::date)
           and sr.student_id in (select user_id from learners)
      )
      or exists (
        select 1
          from app_public.subscriptions s
         where s.payer_id in (select user_id from payers)
           and s.status in ('active', 'past_due', 'trialing')
           and s.current_period_end > now()
      )
    );
$$ language sql stable security definer set search_path to pg_catalog, pg_temp;

comment on function app_public.can_read_course(uuid, uuid) is
  E'Whether a reader may read a course and its content. The reader defaults to the current user. True for staff; for a reader who is enrolled in the course, or who has an active weekly lesson schedule, where a parent reader counts the schedules and enrollments of the students in their families (any course); or who or whose billing contacts have a live subscription (any course). past_due keeps access while Stripe retries the card. A reader other than the current user is reported only to staff and to members of a family the reader belongs to; otherwise the answer is false. The course-access policies all call this function, so changing who may read a course changes it here.';

-- Policies: each table asks can_read_course instead of checking enrollments -----------

create policy select_enrolled on app_public.courses for select
  using (app_public.can_read_course(id));

create policy select_via_course on app_public.modules for select
  using (app_public.can_read_course(course_id));

create policy select_via_module on app_public.module_materials for select
  using (
    exists (
      select 1 from app_public.modules m
       where m.id = module_id
         and app_public.can_read_course(m.course_id)
    )
  );

create policy select_accessible on app_public.materials for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or is_global
    or id in (
      select mm.material_id
        from app_public.module_materials mm
        join app_public.modules m on m.id = mm.module_id
       where app_public.can_read_course(m.course_id)
    )
    or id in (
      select material_id from app_public.student_materials
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );
