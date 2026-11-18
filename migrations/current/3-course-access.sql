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

-- The plan the subscription's price was declared as (shared/pricing.ts), read from the price's
-- metadata.plan, which the sync script writes. An archived price keeps its metadata, so an early
-- subscriber keeps the plan name. Null when the price has no metadata.plan.
alter table app_public.subscriptions add column if not exists plan text;

drop trigger if exists _timestamps on app_public.subscriptions;
create trigger _timestamps
  before insert or update on app_public.subscriptions
  for each row execute function app_private.tg__timestamps();

comment on table app_public.subscriptions is
  E'A Stripe subscription paid by a payer. Written by the Stripe webhook as the root role; the visitor reads only its own payer''s rows.';

-- The payer rule ------------------------------------------------------------------------

-- A subscription is live while Stripe holds it in a paid state and its period has not ended.
-- past_due keeps access while Stripe retries the card. can_read_course and the billing status
-- both ask this function, so the rule is written once.
create or replace function app_public.subscription_is_live(
  p_status text,
  p_current_period_end timestamptz
) returns boolean as $$
  select p_status in ('active', 'past_due', 'trialing') and p_current_period_end > now();
$$ language sql stable set search_path to pg_catalog, pg_temp;

-- The users who pay for the reader: the reader, and the billing contact of every family the reader
-- belongs to. The ledger policies, the subscription policy and can_read_course all ask this
-- function, so the rule is written once. A caller may ask only about readers it may see (itself,
-- staff, or a member of one of the reader's families); for anyone else the set is empty.
create or replace function app_public.family_payers(
  p_reader_id uuid default app_public.current_user_id()
) returns setof uuid as $$
  select payer.user_id
    from (
      select p_reader_id as user_id
      union
      select fm.user_id
        from app_public.family_memberships fm
       where fm.is_billing_contact
         and fm.family_id in (
           select family_id from app_public.family_memberships where user_id = p_reader_id
         )
    ) payer
   where p_reader_id = app_public.current_user_id()
      or app_public.current_user_role() in ('admin', 'teacher')
      or p_reader_id in (
        select fm.user_id
          from app_public.family_memberships fm
         where fm.family_id in (select app_public.current_user_member_family_ids())
      );
$$ language sql stable security definer set search_path to pg_catalog, pg_temp;

comment on function app_public.family_payers(uuid) is
  E'The payers of a reader: the reader, and the billing contact of each family the reader belongs to. Empty for a reader the caller may not see.';

-- How the current user relates to who pays: "self" (no family), "billing_contact" (the user pays
-- for the family), "family_member" (the family has a billing contact who pays), or
-- "no_billing_contact" (the family has none yet, so nobody pays).
create or replace function app_public.payer_relation() returns text as $$
  select case
    when exists (
      select 1 from app_public.family_memberships fm
       where fm.user_id = app_public.current_user_id() and fm.is_billing_contact
    ) then 'billing_contact'
    when not exists (
      select 1 from app_public.family_memberships fm
       where fm.user_id = app_public.current_user_id()
    ) then 'self'
    when exists (
      select 1 from app_public.family_memberships fm
       where fm.is_billing_contact
         and fm.family_id in (select app_public.current_user_member_family_ids())
    ) then 'family_member'
    else 'no_billing_contact'
  end;
$$ language sql stable security definer set search_path to pg_catalog, pg_temp;

-- Whether the current user may start a subscription: 'covered' when a live subscription already
-- reaches the user, 'allowed' for a user who pays for themself or is a family's billing contact,
-- and otherwise why not. Reads the subscriptions under the caller's row security.
create or replace function app_public.checkout_eligibility() returns text as $$
  select case
    when exists (
      select 1 from app_public.subscriptions s
       where s.payer_id in (select app_public.family_payers())
         and app_public.subscription_is_live(s.status, s.current_period_end)
    ) then 'covered'
    else case app_public.payer_relation()
      when 'self' then 'allowed'
      when 'billing_contact' then 'allowed'
      when 'family_member' then 'not_billing_contact'
      else 'no_billing_contact'
    end
  end;
$$ language sql stable security definer set search_path to pg_catalog, pg_temp;

alter table app_public.subscriptions enable row level security;

drop policy if exists select_visible on app_public.subscriptions;
create policy select_visible on app_public.subscriptions for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or payer_id in (select app_public.family_payers())
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
  payers as (
    select p.user_id from app_public.family_payers(p_reader_id) as p(user_id)
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
           and app_public.subscription_is_live(s.status, s.current_period_end)
      )
    );
$$ language sql stable security definer set search_path to pg_catalog, pg_temp;

comment on function app_public.can_read_course(uuid, uuid) is
  E'Whether a reader may read a course and its content. The reader defaults to the current user. True for staff; for a reader who is enrolled in the course, or who has an active weekly lesson schedule, where a parent reader counts the schedules and enrollments of the students in their families (any course); or who or whose billing contacts have a live subscription (any course). past_due keeps access while Stripe retries the card. A reader other than the current user is reported only to staff and to members of a family the reader belongs to; otherwise the answer is false. The course-access policies all call this function, so changing who may read a course changes it here.';

-- Whether a course exists, whatever the caller may read. The course page asks it after a
-- locked course answers not-found, so a missing course is not shown as a subscription prompt.
create or replace function app_public.course_exists(p_course_id uuid) returns boolean as $$
  select exists (select 1 from app_public.courses where id = p_course_id);
$$ language sql stable security definer set search_path to pg_catalog, pg_temp;

-- The ledger policies ------------------------------------------------------------------

-- A reader sees the ledger rows of the payers family_payers() returns, the same rule that decides
-- which subscriptions cover them. These replace the policies of migrations/committed/000004.sql.
drop policy if exists select_bills on app_public.bills;
create policy select_bills on app_public.bills for select using (
  app_public.current_user_role() = 'admin'
  or payer_id in (select app_public.family_payers())
);

drop policy if exists select_payments on app_public.payments;
create policy select_payments on app_public.payments for select using (
  app_public.current_user_role() = 'admin'
  or payer_id in (select app_public.family_payers())
);

drop policy if exists select_credits on app_public.credits;
create policy select_credits on app_public.credits for select using (
  app_public.current_user_role() = 'admin'
  or payer_id in (select app_public.family_payers())
);

drop policy if exists select_discounts on app_public.discounts;
create policy select_discounts on app_public.discounts for select using (
  app_public.current_user_role() = 'admin'
  or payer_id in (select app_public.family_payers())
);

drop policy if exists select_tax_exemptions on app_public.tax_exemptions;
create policy select_tax_exemptions on app_public.tax_exemptions for select using (
  app_public.current_user_role() = 'admin'
  or payer_id in (select app_public.family_payers())
);

drop function if exists app_public.current_user_visible_payer_ids();
drop function if exists app_public.subscription_payers(uuid);

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
