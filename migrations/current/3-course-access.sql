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
