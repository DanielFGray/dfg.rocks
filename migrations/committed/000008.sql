--! Previous: sha1:58517ccd33b9e1ce1c75777794050dec6baebced
--! Hash: sha1:98f993b17e8d87c7d2ae1034e5559d8c9b4f5d92

--! split: 1-current.sql
-- Enter migration here

--! split: 2-family-billing-contact.sql
/*
 * A family's billing contact is a parent, and a family with students always has one.
 *
 * Staff who create a family own it, so they can invite parents and create children,
 * but they never pay for it. A student may join a family only once a parent is its
 * billing contact.
 *
 * A deferred constraint trigger checks the rule when the transaction commits. A
 * transaction may therefore move billing contact in steps (clear the old contact, set
 * the new one, or remove a parent and add another) and only the final state must hold.
 */

-- Rule check ----------------------------------------------------------------------

create or replace function app_private.assert_family_billing_contact(p_family_id uuid) returns void as $$
begin
  -- Lock the family row so two transactions that each change one side of the rule (a
  -- student joins as the last parent leaves) cannot both pass. `for no key update` does not
  -- conflict with the key-share locks that foreign keys to the family take, so inserts that
  -- reference the family do not wait on this check. Each check statement below takes a fresh
  -- snapshot after the lock, so it sees the other transaction's commit.
  perform 1 from app_public.families where id = p_family_id for no key update;

  if exists (
    select 1
      from app_public.family_memberships fm
      join app_public.users u on u.id = fm.user_id
     where fm.family_id = p_family_id
       and fm.is_billing_contact
       and u.role <> 'parent'
  ) then
    raise exception 'A family''s billing contact must be a parent' using errcode = 'BLCNT';
  end if;

  if exists (
    select 1
      from app_public.family_memberships fm
      join app_public.users u on u.id = fm.user_id
     where fm.family_id = p_family_id
       and u.role = 'student'
  ) and not exists (
    select 1
      from app_public.family_memberships fm
     where fm.family_id = p_family_id
       and fm.is_billing_contact
  ) then
    raise exception 'A family needs a parent as its billing contact before it can have students' using errcode = 'BLCNT';
  end if;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, pg_temp;

-- Membership changes check the family they touched. A delete or a move between families
-- touches the old family too.
create or replace function app_private.tg_family_memberships__billing_contact() returns trigger as $$
begin
  if TG_OP <> 'DELETE' then
    perform app_private.assert_family_billing_contact(NEW.family_id);
  end if;
  if TG_OP = 'DELETE' or (TG_OP = 'UPDATE' and OLD.family_id is distinct from NEW.family_id) then
    perform app_private.assert_family_billing_contact(OLD.family_id);
  end if;
  return null;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, pg_temp;

drop trigger if exists _300_family_billing_contact on app_public.family_memberships;
create constraint trigger _300_family_billing_contact
  after insert or update of family_id, user_id, is_billing_contact or delete
  on app_public.family_memberships
  deferrable initially deferred
  for each row execute function app_private.tg_family_memberships__billing_contact();

-- A role change moves a member in or out of the rule without touching a membership row.
create or replace function app_private.tg_users__billing_contact_role() returns trigger as $$
begin
  perform app_private.assert_family_billing_contact(fm.family_id)
    from app_public.family_memberships fm
   where fm.user_id = NEW.id;
  return null;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, pg_temp;

drop trigger if exists _300_family_billing_contact on app_public.users;
create constraint trigger _300_family_billing_contact
  after update of role on app_public.users
  deferrable initially deferred
  for each row
  when (OLD.role is distinct from NEW.role)
  execute function app_private.tg_users__billing_contact_role();

-- Backfill ------------------------------------------------------------------------

/*
 * Brings existing families to the rule. Each family without a parent billing contact
 * gets its earliest-joined parent, and a family with students but no parent to hand it to
 * fails the migration, so the migration never leaves data that breaks the rule. Safe to
 * run again: a family that already has a parent contact is not touched. The deferred
 * trigger above checks the same rule at commit, so this block only chooses who takes
 * the contact; it never needs to be called again.
 */
drop function if exists app_private.assign_family_billing_contacts();

do $$
declare
  v_slugs text;
begin
  -- Clear first: the unique billing-contact index is not deferrable, so the old
  -- contact must be gone before the new one is set.
  update app_public.family_memberships fm
     set is_billing_contact = false
   where fm.is_billing_contact
     and exists (
       select 1 from app_public.users u
        where u.id = fm.user_id and u.role <> 'parent'
     );

  update app_public.family_memberships fm
     set is_billing_contact = true
   where fm.id in (
     select distinct on (candidate.family_id) candidate.id
       from app_public.family_memberships candidate
       join app_public.users u on u.id = candidate.user_id
      where u.role = 'parent'
        and not exists (
          select 1 from app_public.family_memberships contact
           where contact.family_id = candidate.family_id
             and contact.is_billing_contact
        )
      order by candidate.family_id, candidate.created_at, candidate.id
   );

  select string_agg(f.slug::text, ', ' order by f.slug) into v_slugs
    from app_public.families f
   where exists (
       select 1 from app_public.family_memberships fm
         join app_public.users u on u.id = fm.user_id
        where fm.family_id = f.id and u.role = 'student'
     )
     and not exists (
       select 1 from app_public.family_memberships fm
        where fm.family_id = f.id and fm.is_billing_contact
     );

  if v_slugs is not null then
    raise exception 'Families with students have no parent to be their billing contact: %', v_slugs;
  end if;
end;
$$;

-- Membership operations -----------------------------------------------------------

-- create_family makes staff the owner, so a joining user takes ownership only in a
-- family that has none. A joining parent takes billing contact when the family has
-- none, so a student who joins later has a payer. Staff and students never take it.
create or replace function app_private.join_family(p_family_id uuid, p_user_id uuid) returns void as $$
begin
  -- Lock the family first. A concurrent join then waits for this one to commit, and the
  -- insert below takes its snapshot after that wait, so it sees the owner and billing
  -- contact this join committed. Without the lock, both joins can read "no billing contact"
  -- and the second is dropped by the conflict clause.
  perform 1 from app_public.families where id = p_family_id for no key update;

  -- Name the (family_id, user_id) key so any other violation, such as a second billing
  -- contact, is raised instead of skipped.
  insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
  select
    p_family_id,
    u.id,
    u.role <> 'student' and not exists (
      select 1 from app_public.family_memberships
       where family_id = p_family_id and is_owner
    ),
    u.role = 'parent' and not exists (
      select 1 from app_public.family_memberships
       where family_id = p_family_id and is_billing_contact
    )
  from app_public.users u
  where u.id = p_user_id
  on conflict (family_id, user_id) do nothing;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, pg_temp;

-- Staff who create a family own it. They are not its billing contact; the first
-- parent to join becomes it.
create or replace function app_public.create_family(slug citext, name text) returns app_public.families as $$
declare
  v_org app_public.families;
begin
  if app_public.current_user_role() is distinct from 'admin'
     and app_public.current_user_role() is distinct from 'teacher' then
    raise exception 'Only staff can create a family' using errcode = 'DNIED';
  end if;
  insert into app_public.families (slug, name) values (slug, name) returning * into v_org;
  insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
    values (v_org.id, app_public.current_user_id(), true, false);
  return v_org;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

-- Removing a member clears their own billing contact flag. The deferred check then
-- refuses the removal if the family still has students and no other parent takes over.
create or replace function app_public.remove_from_family(
  family_id uuid,
  user_id uuid
) returns void as $$
declare
  v_my_membership app_public.family_memberships;
begin
  select * into v_my_membership
    from app_public.family_memberships
    where family_memberships.family_id = remove_from_family.family_id
    and family_memberships.user_id = app_public.current_user_id();

  if v_my_membership is null then
    -- I'm not a member of that family
    return;
  elsif v_my_membership.is_owner then
    if remove_from_family.user_id = app_public.current_user_id() then
      -- Need to transfer ownership before I can leave
      return;
    end if;
  elsif v_my_membership.user_id <> remove_from_family.user_id then
    -- Not allowed to delete it
    return;
  end if;

  delete from app_public.family_memberships
    where family_memberships.family_id = remove_from_family.family_id
    and family_memberships.user_id = remove_from_family.user_id;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

-- Deleting a user removes their memberships. Billing contact is not handed to the
-- owner: if the deleted user was the contact of a family with students, the deferred
-- check refuses the deletion until another parent is the contact.
create or replace function app_public.tg_users__deletion_family_checks_and_actions() returns trigger as $$
begin
  if exists(
    select 1 from app_public.family_memberships
     where user_id = OLD.id
       and is_owner is true
  ) then
    raise exception 'You cannot delete your account until you are not the owner of any families.' using errcode = 'OWNER';
  end if;

  return OLD;
end;
$$ language plpgsql volatile set search_path to pg_catalog, public, pg_temp;

--! split: 3-course-access.sql
/*
 * Who pays for a reader: subscriptions, the payer rule (family_payers) and the ledger
 * policies that follow it. 7-content-visibility.sql builds the course-access rule on them.
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

--! split: 4-user-role.sql
/*
 * An admin sets any account's role. The visitor may update only a user's profile columns
 * (username, name, bio, avatar_url), so the role change runs here, as the function owner.
 *
 * Refusals, in the order they are checked:
 *   - the caller is not an admin (DNIED)
 *   - the caller names its own account (DNIED): an admin cannot change their own role
 *
 * The last admin cannot be demoted, and no separate check is needed for it. Every call takes
 * the admin-row lock before it reads the caller's role. A call that waits on another call's
 * lock therefore reads the caller's role after that call commits, so the caller is still an
 * admin when the change runs. The caller is never the target, so each committed change leaves
 * its caller an admin.
 *
 * This argument needs READ COMMITTED, where each statement sees the data committed before it
 * starts. Under REPEATABLE READ the waiting call fails with a serialization error instead, which
 * is also a refusal.
 *
 * A parent who is the billing contact of a family with students is refused by the deferred
 * trigger in 2-family-billing-contact.sql, at commit, so this function does not repeat that rule.
 *
 * Reruns safely: `graphile-migrate watch` applies this file after each edit, and the release
 * commit applies it again on a database that already has it.
 */

create or replace function app_public.set_user_role(p_user_id uuid, p_role app_public.user_role)
returns app_public.users as $$
declare
  v_user app_public.users;
begin
  -- Lock first, in id order. A concurrent call waits here; once it commits, the lock re-checks
  -- `role = 'admin'`, so the role checks below run on the committed state. Each check takes a
  -- fresh snapshot, because each statement does.
  perform 1 from app_public.users where role = 'admin' order by id for update;

  if app_public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change a role' using errcode = 'DNIED';
  end if;

  if p_user_id = app_public.current_user_id() then
    raise exception 'You cannot change your own role' using errcode = 'DNIED';
  end if;

  update app_public.users set role = p_role where id = p_user_id returning * into v_user;
  if not found then
    raise exception 'User not found' using errcode = 'NTFND';
  end if;
  return v_user;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, pg_temp;

grant execute on function app_public.set_user_role(uuid, app_public.user_role) to :DATABASE_VISITOR;

--! split: 5-staff-read-memberships.sql
/*
 * Staff (admin and teacher) read every family's memberships, so the person page can show a
 * person's families to a teacher. The policy keeps its name and its one clause; only the role
 * list changes. Member and invited readers keep their own policies (select_member,
 * select_invited) and see only their families.
 *
 * Reruns safely: `graphile-migrate watch` applies this file after each edit, and the release
 * commit applies it again on a database that already has it.
 */

drop policy if exists select_admin on app_public.family_memberships;
create policy select_admin on app_public.family_memberships for select using (
  app_public.current_user_role() in ('admin', 'teacher')
);

--! split: 6-stripe-events.sql
/*
 * The Stripe events the webhook has received. The primary key makes a redelivered event a no-op:
 * the webhook inserts the event id in the same transaction as the event's effect, so an event
 * whose effect fails leaves no id behind and Stripe's retry applies it.
 *
 * Every statement here reruns safely: `graphile-migrate watch` applies this file after each edit,
 * and the release commit applies it again on a database that already has it.
 */

create table if not exists app_private.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

comment on table app_private.stripe_events is
  E'Stripe event ids the webhook has applied. Written by the webhook as the root role; no visitor reads it.';

--! split: 7-content-visibility.sql
/*
 * Who may read a course and a material is one of three levels, set on the row:
 *   public  any signed-in account, whatever its role (a free account has no role)
 *   global  an admitted account: one whose role is not null
 *   course  only through enrollment, a schedule or a subscription (courses), or through a
 *           module of a readable course or a direct assignment (materials)
 * A course's modules and module_materials follow the course. A material attached to a module
 * of a readable course is readable whatever its own level.
 *
 * can_read_course is the one rule for courses; its policies on courses, modules, module_materials
 * and materials all ask it. materials.is_global becomes materials.visibility (true is 'global',
 * false is 'course'). The free course at the end is seeded with fixed ids that other sites link to.
 *
 * Every statement here reruns safely: `graphile-migrate watch` applies the files after each
 * edit, and the release commit applies them again on a database that already has them.
 */

-- The levels ------------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'app_public' and t.typname = 'content_visibility'
  ) then
    create type app_public.content_visibility as enum ('public', 'global', 'course');
  end if;
end;
$$;

comment on type app_public.content_visibility is
  E'Who may read a course or a material: public (any signed-in account), global (an account with a role), course (only through enrollment, a module or an assignment).';

alter table app_public.courses
  add column if not exists visibility app_public.content_visibility not null default 'course';

alter table app_public.materials
  add column if not exists visibility app_public.content_visibility not null default 'course';

-- The old materials policy reads is_global, so it goes before the column does; the policies
-- below recreate it. Once the column is gone the conversion has run, and a rerun skips it.
drop policy if exists select_enrolled on app_public.courses;
drop policy if exists select_via_course on app_public.modules;
drop policy if exists select_via_module on app_public.module_materials;
drop policy if exists select_accessible on app_public.materials;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'app_public' and table_name = 'materials' and column_name = 'is_global'
  ) then
    update app_public.materials
       set visibility = case when is_global then 'global' else 'course' end::app_public.content_visibility;
    alter table app_public.materials drop column is_global;
  end if;
end;
$$;

-- The access rule ------------------------------------------------------------------------

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
      -- The course's own level: public needs only a signed-in account, global an admitted one.
      or exists (
        select 1
          from app_public.courses c
          join app_public.users u on u.id = p_reader_id
         where c.id = p_course_id
           and (c.visibility = 'public' or (c.visibility = 'global' and u.role is not null))
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
  E'Whether a reader may read a course and its content. The reader defaults to the current user. True for staff; for any signed-in reader when the course is public, and for an admitted reader (role not null) when it is global; for a reader who is enrolled in the course, or who has an active weekly lesson schedule, where a parent reader counts the schedules and enrollments of the students in their families (any course); or who or whose billing contacts have a live subscription (any course). past_due keeps access while Stripe retries the card. A reader other than the current user is reported only to staff and to members of a family the reader belongs to; otherwise the answer is false. The course-access policies all call this function, so changing who may read a course changes it here.';

-- Whether a course exists, whatever the caller may read. The course page asks it after a
-- locked course answers not-found, so a missing course is not shown as a subscription prompt.
create or replace function app_public.course_exists(p_course_id uuid) returns boolean as $$
  select exists (select 1 from app_public.courses where id = p_course_id);
$$ language sql stable security definer set search_path to pg_catalog, pg_temp;

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
    or (visibility = 'public' and app_public.current_user_id() is not null)
    or (visibility = 'global' and app_public.current_user_role() is not null)
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

-- The free course ------------------------------------------------------------------------

-- Two posts moved here from dfg.codes, which answers 301 to these ids. "on conflict do nothing"
-- keeps edits made in the admin UI across reruns. A module's content is a TipTap document;
-- an alphaTex node holds the source of a score that gigbag.js draws and plays.

insert into app_public.courses (id, title, description, instrument, visibility)
values (
  'b923f9a1-ae77-4daa-b434-67a06a8435a9',
  'Drum rudiments',
  'A free introduction to the rudiments: learn the single stroke, the double stroke and the paradiddle, then permute them into new exercises.',
  'drums',
  'public'
)
on conflict (id) do nothing;

insert into app_public.modules (id, course_id, title, sort_order, content)
values (
  '6e53f13a-30d4-4efa-9113-2460871d29fe',
  'b923f9a1-ae77-4daa-b434-67a06a8435a9',
  'Beginning drums',
  0,
  $content${"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a[n unfinished] guide to learning drums"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"TODO: Playing drums is great because you can do it anywhere without sticks."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"TODO: Percussion is the art of turning noise into music."}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"TODO: images instead of crude ASCII"}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"First Steps"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Single Strokes"}]},{"type":"paragraph","content":[{"type":"text","text":"Pat your right hand on your right leg and then your left hand on your left leg, for each hit say a syllable of the word \"single\"."}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"sin-gle sin-gle sin-gle sin-gle\nx   x   x   x   x   x   x   x\nR   L   R   L   R   L   R   L"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Double Strokes"}]},{"type":"paragraph","content":[{"type":"text","text":"Now, while keeping the same rhythm, instead of patting each leg once, pat each leg twice and say \"double\" instead of \"single\"."}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"dou-ble dou-ble dou-ble dou-ble\nx   x   x   x   x   x   x   x\nR   R   L   L   R   R   L   L"}]},{"type":"paragraph","content":[{"type":"text","text":"Let's try both of those together:"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"sin-gle sin-gle sin-gle sin-gle dou-ble dou-ble dou-ble dou-ble\nx   x   x   x   x   x   x   x   x   x   x   x   x   x   x   x\nR   L   R   L   R   L   R   L   R   R   L   L   R   R   L   L"}]},{"type":"paragraph","content":[{"type":"text","text":"You've now learned two rudiments, the single stroke roll and the double stroke roll."}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Paradiddles"}]},{"type":"paragraph","content":[{"type":"text","text":"The next, and arguably most important rudiment to learn, is the paradiddle: it is made of a single and a double."}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"sin-gle dou-ble\nx   x   x   x\nR   L   R   R\nsin-gle dou-ble\nx   x   x   x\nL   R   L   L"}]},{"type":"paragraph","content":[{"type":"text","text":"Notice that the second half is the opposite of the first: The first pattern is a single stroke and a double stroke starting with the right hand, the second pattern is a single stroke and a double stroke, but it starts with the left hand."}]},{"type":"paragraph","content":[{"type":"text","text":"This idea of playing a pattern, and then playing it's opposite is a crucial concept in drumming, the second form often called the 'inversion'."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Putting it all together"}]},{"type":"paragraph","content":[{"type":"text","text":"You've now learned three rudiments!"}]},{"type":"paragraph","content":[{"type":"text","text":"Let's try and play four of each of them."}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"sin-gle sin-gle sin-gle sin-gle\nx   x   x   x   x   x   x   x\nR   L   R   L   R   L   R   L\n\ndou-ble dou-ble dou-ble dou-ble\nx   x   x   x   x   x   x   x\nR   R   L   L   R   R   L   L\n\nsin-gle dou-ble sin-gle dou-ble\nx   x   x   x   x   x   x   x\nR   L   R   R   L   R   L   L\n\nsin-gle dou-ble sin-gle dou-ble\nx   x   x   x   x   x   x   x\nR   L   R   R   L   R   L   L"}]},{"type":"paragraph","content":[{"type":"text","text":"Make sure to keep a consistent rhythm with each hit. Just because you're playing a double, doesn't mean you have to play it twice as fast! Each note should have the same amount of time to \"breathe\" as every other note."}]},{"type":"paragraph","content":[{"type":"text","text":"Once you're comfortable with the mechanics, try playing along to a metronome. If you don't have access to a metronome (or don't want to install one on your phone), find a clock, and use it as your time keeper, start with playing one note per second, then playing two notes per second, and then up to four notes per second."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"After thoughts"}]},{"type":"paragraph","content":[{"type":"text","text":"\"What is this rudiment thing you keep saying?\" you might think."}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"rudiment ["},{"type":"text","text":"roo","marks":[{"type":"bold"}]},{"type":"text","text":"-d"},{"type":"text","text":"uh","marks":[{"type":"italic"}]},{"type":"text","text":"-m"},{"type":"text","text":"uh","marks":[{"type":"italic"}]},{"type":"text","text":" nt] >"},{"type":"hardBreak"},{"type":"text","text":"Usually, rudiments the elements or first principles of a subject: the rudiments of grammar 1540-50; < Latin "},{"type":"text","text":"rudīmentum","marks":[{"type":"italic"}]},{"type":"text","text":" early training, first experience, initial stage, equivalent to "},{"type":"text","text":"rudi(s)","marks":[{"type":"italic"}]},{"type":"text","text":" unformed, rough + "},{"type":"text","text":"-mentum","marks":[{"type":"italic"}]},{"type":"text","text":" -ment ("},{"type":"text","text":"-ī-","marks":[{"type":"italic"}]},{"type":"text","text":" for "},{"type":"text","text":"-i-","marks":[{"type":"italic"}]},{"type":"text","text":" after verbal derivatives) "},{"type":"text","text":"Source: dictionary.com","marks":[{"type":"italic"}]}]}]},{"type":"paragraph","content":[{"type":"text","text":"Simply put, they are the building blocks of drumming. You could think of rudiments as words. Each word is made of letters, in this case, we've used only two letters."}]},{"type":"paragraph","content":[{"type":"text","text":"There is a third letter, the "},{"type":"text","text":"flam","marks":[{"type":"italic"}]},{"type":"text","text":":"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"lR\nrL"}]},{"type":"paragraph","content":[{"type":"text","text":"In music theory that small note is called a "},{"type":"text","text":"grace note","marks":[{"type":"italic"}]},{"type":"text","text":". It sounds like a note that happens just before another note, often played slightly quieter. These three letters make up everything you will find in the world of percussion, they are the alphabet of drumming, and rudiments are the vocabulary a drummer speaks."}]}]}$content$::jsonb
)
on conflict (id) do nothing;

insert into app_public.modules (id, course_id, title, sort_order, content)
values (
  'b2868acb-0716-4805-b2a1-c30c910ba38a',
  'b923f9a1-ae77-4daa-b434-67a06a8435a9',
  'Rudimental permutations',
  1,
  $content${"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"This post is still a work in progress, so bare with me please. If you spot any errors or have something you want to add, feel free to leave a comment below."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Displacing Accents"}]},{"type":"paragraph","content":[{"type":"text","text":"Let's begin with some simple exercises and warm-ups, using basic rudiments and moving the placement of an accent note forward by one note."}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Single Strokes"}]},{"type":"alphaTex","attrs":{"tex":"\\title \"Displacing the Accent - Single Strokes\"\n\\tempo 100\n\\track \"Snare\"\n\\instrument percussion\n\\clef neutral\n\\articulation defaults\n.\n\\lyrics \"R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L R L\"\nSnareHit{ac}.16 SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit |\nSnareHit.16 SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit |\nSnareHit.16 SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit |\nSnareHit.16 SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} |"}},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Double Strokes"}]},{"type":"alphaTex","attrs":{"tex":"\\title \"Displacing the Accent - Double Strokes\"\n\\tempo 100\n\\track \"Snare\"\n\\instrument percussion\n\\clef neutral\n\\articulation defaults\n.\n\\lyrics \"R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L R R L L\"\nSnareHit{ac}.16 SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit |\nSnareHit.16 SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit |\nSnareHit.16 SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit |\nSnareHit.16 SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} |"}},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Double Strokes"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Single Paradiddles"}]},{"type":"alphaTex","attrs":{"tex":"\\title \"Displacing the Accent - Paradiddles\"\n\\tempo 100\n\\track \"Snare\"\n\\instrument percussion\n\\clef neutral\n\\articulation defaults\n.\n\\lyrics \"R L R R L R L L R L R R L R L L R L R R L R L L R L R R L R L L R L R R L R L L R L R R L R L L R L R R L R L L R L R R L R L L\"\nSnareHit{ac}.16 SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit | \nSnareHit.16 SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit |\nSnareHit.16 SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit |\nSnareHit.16 SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} SnareHit SnareHit SnareHit SnareHit{ac} |"}},{"type":"paragraph","content":[{"type":"text","text":"I've heard this concept also called practicing \"grids\", but there's a mathematical term for this, called "},{"type":"text","text":"permutations","marks":[{"type":"italic"}]},{"type":"text","text":"."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Permutations"}]},{"type":"paragraph","content":[{"type":"text","text":"Wikipedia has a page on permutations, the introduction right now says:"}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"\"In mathematics, the notion of permutation relates to the act of arranging all the members of a set into some sequence or order, or if the set is already ordered, rearranging (reordering) its elements, a process called permuting.\""}]}]},{"type":"paragraph","content":[{"type":"text","text":"It then goes on to describe it's relation to set theory and computer algorithm sorting, and then a lot of math."}]},{"type":"paragraph","content":[{"type":"text","text":"Permutations are somewhat of an umbrella term for many ideas."}]},{"type":"paragraph","content":[{"type":"text","text":"Anagrams are a common form of permutations: \"now\", \"own\", and \"won\" use the same set of letters without repeating or missing any."}]},{"type":"paragraph","content":[{"type":"text","text":"This is contrast from combinations, where you can repeat or remove items from a set."}]},{"type":"paragraph","content":[{"type":"text","text":"Musical modes are another example of permutations: the steps in the major scale could be expressed as \"WWHWWWH\". The Dorian mode is \"WHWWWHW\", which was made by taking the first \"W\" and moving it to the end. All seven modes of the major scale are as follows:"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"Ionian    WWHWWWH\nDorian     WHWWWHW\nPhrygian    HWWWHWW\nLydian       WWWHWWH\nMixolydian    WWHWWHW\nAeolian        WHWWHWW\nLocrian         HWWHWWW"}]},{"type":"paragraph","content":[{"type":"text","text":"I'm going to exclusively be talking about "},{"type":"text","text":"cyclic permutations","marks":[{"type":"italic"}]},{"type":"text","text":", which is what musical modes are, as opposed to unordered permutations, like anagrams. We'll look at rudiments and try to make variations of them by shifting the order around."}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Permuting the Single Paradiddle"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"Fig. 1\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nR-L-R-R-L-R-L-L-R-L-R-R-L-R-L-L-"}]},{"type":"paragraph","content":[{"type":"text","text":"Now let's take that first R and move it to the end of the pattern"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"Fig. 2\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nL-R-R-L-R-L-L-R-L-R-R-L-R-L-L-R-"}]},{"type":"paragraph","content":[{"type":"text","text":"and continue the process"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"Fig. 3\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nR-R-L-R-L-L-R-L-R-R-L-R-L-L-R-L-\n\nFig. 4\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nR-L-R-L-L-R-L-R-R-L-R-L-L-R-L-R-\n\nFig. 5\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nL-R-L-L-R-L-R-R-L-R-L-L-R-L-R-R-\n\nFig. 6\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nR-L-L-R-L-R-R-L-R-L-L-R-L-R-R-L-\n\nFig. 7\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nL-L-R-L-R-R-L-R-L-L-R-L-R-R-L-R-\n\nFig. 8\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nL-R-L-R-R-L-R-L-L-R-L-R-R-L-R-L-"}]},{"type":"paragraph","content":[{"type":"text","text":"Now, start displacing the accents over the permuted rudiments!"}]},{"type":"horizontalRule"},{"type":"paragraph","content":[{"type":"text","text":"If we analyze these patterns, we can group them into four variations"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"ABAA/BABB - figs. 1 and 5\nABBA/BAAB - figs. 2 and 6\nAABA/BBAB - figs. 3 and 7\nABAB/BABA - figs. 4 and 8"}]},{"type":"paragraph","content":[{"type":"text","text":"I prefer this form of \"A/B\" notation over \"R/L\" because it forces me to think more about how to apply it."}]},{"type":"paragraph","content":[{"type":"text","text":"It could be starting with my dominant hand, or it could be the inversion."}]},{"type":"paragraph","content":[{"type":"text","text":"I might not even play it with my hands, maybe I'll play it with my feet, or between the bass and snare drums."}]},{"type":"paragraph","content":[{"type":"text","text":"In fact, you can take just about any pattern apply it six different ways:"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"between both hands: right-hand + left-hand"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"between both feet: right-foot + left-foot"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"between both rights: right-hand + right-foot"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"between both lefts: left-hand + left-foot"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"diagonally one way: right-hand + left-foot"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"diagonally the other way: left-hand + right-foot"}]}]}]},{"type":"paragraph","content":[{"type":"text","text":"Now try and play the four variations (and their inversions) across all six limb-combinations!"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Permuting the double paradiddle"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"1-&-a-2-&-a-3-&-a-4-&-a-\nR-L-R-L-R-R-L-R-L-R-L-L-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-L-R-R-L-R-L-R-L-L-R-L-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-R-L-R-L-R-L-L-R-L-R-L-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-L-R-L-R-L-L-R-L-R-L-R-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-L-R-L-L-R-L-R-L-R-R-L-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-L-L-R-L-R-L-R-R-L-R-L-"}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"More exercises"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Single-stroked Hertas in three"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"1-&-a-2-&-a-3-&-a-4-&-a-\nRLR-L-RLR-L-RLR-L-RLR-L-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-L-RLR-L-RLR-L-RLR-L-RL\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-LRL-R-LRL-R-LRL-R-LRL-"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Double-stroked Hertas in three"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"1-&-a-2-&-a-3-&-a-4-&-a-\nRRL-R-LLR-L-RRL-R-LLR-L-\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nL-R-LLR-L-RRL-R-LLR-L-RR\n\n1-&-a-2-&-a-3-&-a-4-&-a-\nR-LLR-L-RRL-R-LLR-L-RRL-"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Single-stroked Hertas in four"}]},{"type":"codeBlock","attrs":{"language":null},"content":[{"type":"text","text":"1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nRLR-L-R-LRL-R-L-RLR-L-R-LRL-R-L-\n\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nR-L-R-LRL-R-L-RLR-L-R-LRL-R-L-RL\n\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nL-R-LRL-R-L-RLR-L-R-LRL-R-L-RLR-\n\n1-e-&-a-2-e-&-a-3-e-&-a-4-e-&-a-\nR-LRL-R-L-RLR-L-R-LRL-R-L-RLR-L-"}]}]}$content$::jsonb
)
on conflict (id) do nothing;
