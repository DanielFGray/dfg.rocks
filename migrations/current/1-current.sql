/*
 * Bill the paying user instead of the family.
 *
 * The payer of a lesson is one user: a student in a family is paid for by that
 * family's billing contact, and everyone else pays for themselves. Bills,
 * payments, credits, discounts and tax exemptions belong to that payer. A
 * family decides only who may see a payer's ledger: the payer, and the members
 * of every family the payer is billing contact for.
 *
 * A student belongs to at most one family, so the payer of a student is never
 * ambiguous. Parents may belong to several families. Each family has at most
 * one billing contact; create_family, accept_invitation_to_family,
 * remove_from_family and the user deletion trigger keep one in place once a
 * parent has joined.
 */

-- Membership rules ----------------------------------------------------------

create unique index if not exists family_memberships_one_billing_contact
  on app_public.family_memberships (family_id)
  where is_billing_contact;

create or replace function app_private.assert_student_in_one_family(p_user_id uuid) returns void as $$
begin
  -- Lock the user row so two concurrent joins for one student cannot both pass.
  perform 1 from app_public.users where id = p_user_id for update;
  if exists (select 1 from app_public.users where id = p_user_id and role = 'student')
     and (select count(*) from app_public.family_memberships where user_id = p_user_id) > 1 then
    raise exception 'A student can belong to only one family' using errcode = 'DNIED';
  end if;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

create or replace function app_private.tg_family_memberships__one_family_per_student() returns trigger as $$
begin
  perform app_private.assert_student_in_one_family(NEW.user_id);
  return null;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

drop trigger if exists _200_one_family_per_student on app_public.family_memberships;
create constraint trigger _200_one_family_per_student
  after insert or update of user_id on app_public.family_memberships
  for each row execute function app_private.tg_family_memberships__one_family_per_student();

create or replace function app_private.tg_users__one_family_per_student() returns trigger as $$
begin
  perform app_private.assert_student_in_one_family(NEW.id);
  return null;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

drop trigger if exists _200_one_family_per_student on app_public.users;
create constraint trigger _200_one_family_per_student
  after update of role on app_public.users
  for each row when (NEW.role = 'student' and OLD.role <> 'student')
  execute function app_private.tg_users__one_family_per_student();

-- The unique billing contact index needs the old contact cleared before the
-- new one is set.
create or replace function app_public.transfer_family_billing_contact(family_id uuid, user_id uuid)
returns app_public.families as $$
declare
  v_org app_public.families;
begin
  if not exists(
    select 1 from app_public.family_memberships
     where family_memberships.user_id = app_public.current_user_id()
       and family_memberships.family_id = transfer_family_billing_contact.family_id
       and is_owner is true
  ) or not exists(
    select 1 from app_public.family_memberships
     where family_memberships.family_id = transfer_family_billing_contact.family_id
       and family_memberships.user_id = transfer_family_billing_contact.user_id
  ) then
    return null;
  end if;

  update app_public.family_memberships
     set is_billing_contact = false
   where family_memberships.family_id = transfer_family_billing_contact.family_id
     and family_memberships.user_id <> transfer_family_billing_contact.user_id
     and is_billing_contact;
  update app_public.family_memberships
     set is_billing_contact = true
   where family_memberships.family_id = transfer_family_billing_contact.family_id
     and family_memberships.user_id = transfer_family_billing_contact.user_id;

  select * into v_org from app_public.families where id = transfer_family_billing_contact.family_id;
  return v_org;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

create or replace function app_public.tg_users__deletion_family_checks_and_actions() returns trigger as $$
begin
  if exists(
    select 1 from app_public.family_memberships
     where user_id = OLD.id
       and is_owner is true
  ) then
    raise exception 'You cannot delete your account until you are not the owner of any families.' using errcode = 'OWNER';
  end if;

  -- Hand billing contact status back to each family owner. Clear it first:
  -- a family has at most one billing contact.
  with released as (
    update app_public.family_memberships
       set is_billing_contact = false
     where user_id = OLD.id
       and is_billing_contact
    returning family_id
  )
  update app_public.family_memberships
     set is_billing_contact = true
   where is_owner
     and family_id in (select family_id from released);

  return OLD;
end;
$$ language plpgsql volatile set search_path to pg_catalog, public, pg_temp;

-- An admin creates a family with no members and invites its parents. The
-- first parent to join takes the roles nobody holds yet, so the family's
-- students always have a payer.
create or replace function app_private.join_family(p_family_id uuid, p_user_id uuid) returns void as $$
  insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
  select
    p_family_id,
    u.id,
    u.role <> 'student' and not exists (
      select 1 from app_public.family_memberships
       where family_id = p_family_id and is_owner
    ),
    u.role <> 'student' and not exists (
      select 1 from app_public.family_memberships
       where family_id = p_family_id and is_billing_contact
    )
  from app_public.users u
  where u.id = p_user_id
  on conflict do nothing;
$$ language sql volatile security definer set search_path to pg_catalog;

create or replace function app_public.accept_invitation_to_family(invitation_id uuid, code text default null)
returns void as $$
declare
  v_family app_public.families;
begin
  v_family = app_public.family_for_invitation(invitation_id, code);
  perform app_private.join_family(v_family.id, app_public.current_user_id());
  delete from app_public.family_invitations where id = invitation_id;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

-- The payer rule --------------------------------------------------------------

-- Admins manage families, and student_payers reads memberships with the
-- caller's rights, so admins must see every membership.
drop policy if exists select_admin on app_public.family_memberships;
create policy select_admin on app_public.family_memberships for select using (
  app_public.current_user_role() = 'admin'
);

-- Runs with the caller's row security. Only a caller who can see a student's
-- family membership gets the student's real payer; admins see all of them.
create or replace view app_public.student_payers with (security_invoker = true) as
  select
    u.id as student_id,
    case
      when membership.family_id is null then u.id
      else contact.user_id
    end as payer_id
  from app_public.users u
  left join app_public.family_memberships membership
    on membership.user_id = u.id
   and u.role = 'student'
  left join app_public.family_memberships contact
    on contact.family_id = membership.family_id
   and contact.is_billing_contact;

comment on view app_public.student_payers is
  E'The user who pays for each user''s lessons: the billing contact of a student''s family, else the user. payer_id is null for a student whose family has no billing contact.';

grant select on app_public.student_payers to :DATABASE_VISITOR;

create or replace function app_public.payer_id_for_student(p_student_id uuid) returns uuid as $$
declare
  v_found boolean;
  v_payer_id uuid;
begin
  select true, sp.payer_id into v_found, v_payer_id
    from app_public.student_payers sp
   where sp.student_id = p_student_id;
  if v_found is null then
    raise exception 'Student not found' using errcode = 'NTFND';
  end if;
  if v_payer_id is null then
    raise exception 'The student''s family has no billing contact' using errcode = 'DNIED';
  end if;
  return v_payer_id;
end;
$$ language plpgsql stable security definer set search_path to pg_catalog;

create or replace function app_public.current_user_visible_payer_ids() returns setof uuid as $$
  select app_public.current_user_id()
  union
  select fm.user_id
    from app_public.family_memberships fm
   where fm.is_billing_contact
     and fm.family_id in (select app_public.current_user_member_family_ids());
$$ language sql stable security definer set search_path to pg_catalog;

comment on function app_public.current_user_visible_payer_ids() is
  E'Payers whose ledger the current user may read: the user, and the billing contact of each family the user belongs to.';

-- Tables ----------------------------------------------------------------------

drop function if exists app_public.current_user_is_billing_contact_for(uuid);
drop function if exists app_public.next_bill_number(uuid);
drop function if exists app_public.next_payment_number(uuid);
drop table if exists app_public.bill_number_sequences;
drop table if exists app_public.payment_number_sequences;

create or replace function app_public.next_bill_number() returns integer as $$
  select nextval('app_public.bill_number_seq')::integer;
$$ language sql volatile security definer set search_path to pg_catalog;

create or replace function app_public.next_payment_number() returns integer as $$
  select nextval('app_public.payment_number_seq')::integer;
$$ language sql volatile security definer set search_path to pg_catalog;

alter table app_public.bills drop constraint if exists bills_family_id_fkey;
do $$
begin
  if exists (select 1 from pg_attribute where attrelid = 'app_public.bills'::regclass and attname = 'family_id' and not attisdropped) then
    alter table app_public.bills rename column family_id to payer_id;
  end if;
end;
$$;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'app_public.bills'::regclass and conname = 'bills_payer_id_fkey') then
    alter table app_public.bills
      add constraint bills_payer_id_fkey foreign key (payer_id) references app_public.users(id) on delete restrict;
  end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'app_public.bills'::regclass and conname = 'bills_family_id_bill_number_key') then
    alter table app_public.bills rename constraint bills_family_id_bill_number_key to bills_payer_id_bill_number_key;
  end if;
end;
$$;
do $$
begin
  if to_regclass('app_public.bills_family_status') is not null then
    alter index app_public.bills_family_status rename to bills_payer_status;
  end if;
end;
$$;

alter table app_public.payments drop constraint if exists payments_family_id_fkey;
do $$
begin
  if exists (select 1 from pg_attribute where attrelid = 'app_public.payments'::regclass and attname = 'family_id' and not attisdropped) then
    alter table app_public.payments rename column family_id to payer_id;
  end if;
end;
$$;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'app_public.payments'::regclass and conname = 'payments_payer_id_fkey') then
    alter table app_public.payments
      add constraint payments_payer_id_fkey foreign key (payer_id) references app_public.users(id) on delete restrict;
  end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'app_public.payments'::regclass and conname = 'payments_family_id_payment_number_key') then
    alter table app_public.payments rename constraint payments_family_id_payment_number_key to payments_payer_id_payment_number_key;
  end if;
end;
$$;
do $$
begin
  if to_regclass('app_public.payments_family') is not null then
    alter index app_public.payments_family rename to payments_payer;
  end if;
end;
$$;

do $$
begin
  if to_regclass('app_public.family_credits') is not null then
    alter table app_public.family_credits rename to credits;
  end if;
end;
$$;
alter table app_public.credits drop constraint if exists family_credits_family_id_fkey;
do $$
begin
  if exists (select 1 from pg_attribute where attrelid = 'app_public.credits'::regclass and attname = 'family_id' and not attisdropped) then
    alter table app_public.credits rename column family_id to payer_id;
  end if;
end;
$$;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'app_public.credits'::regclass and conname = 'credits_payer_id_fkey') then
    alter table app_public.credits
      add constraint credits_payer_id_fkey foreign key (payer_id) references app_public.users(id) on delete restrict;
  end if;
end;
$$;
do $$
begin
  if to_regclass('app_public.family_credits_pkey') is not null then
    alter index app_public.family_credits_pkey rename to credits_pkey;
  end if;
end;
$$;
do $$
begin
  if to_regclass('app_public.family_credits_family') is not null then
    alter index app_public.family_credits_family rename to credits_payer;
  end if;
end;
$$;
do $$
begin
  if to_regclass('app_public.family_credits_unconsumed') is not null then
    alter index app_public.family_credits_unconsumed rename to credits_unconsumed;
  end if;
end;
$$;
do $$
begin
  if to_regclass('app_public.family_credits_source_payment') is not null then
    alter index app_public.family_credits_source_payment rename to credits_source_payment;
  end if;
end;
$$;

do $$
begin
  if to_regclass('app_public.family_credit_applications') is not null then
    alter table app_public.family_credit_applications rename to credit_applications;
  end if;
end;
$$;
do $$
begin
  if to_regclass('app_public.family_credit_applications_pkey') is not null then
    alter index app_public.family_credit_applications_pkey rename to credit_applications_pkey;
  end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'app_public.credit_applications'::regclass and conname = 'family_credit_applications_credit_id_bill_id_key') then
    alter table app_public.credit_applications
      rename constraint family_credit_applications_credit_id_bill_id_key to credit_applications_credit_id_bill_id_key;
  end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'app_public.credit_applications'::regclass and conname = 'family_credit_applications_credit_id_fkey') then
    alter table app_public.credit_applications
      rename constraint family_credit_applications_credit_id_fkey to credit_applications_credit_id_fkey;
  end if;
end;
$$;

do $$
begin
  if to_regclass('app_public.family_discounts') is not null then
    alter table app_public.family_discounts rename to discounts;
  end if;
end;
$$;
alter table app_public.discounts drop constraint if exists family_discounts_family_id_fkey;
do $$
begin
  if exists (select 1 from pg_attribute where attrelid = 'app_public.discounts'::regclass and attname = 'family_id' and not attisdropped) then
    alter table app_public.discounts rename column family_id to payer_id;
  end if;
end;
$$;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'app_public.discounts'::regclass and conname = 'discounts_payer_id_fkey') then
    alter table app_public.discounts
      add constraint discounts_payer_id_fkey foreign key (payer_id) references app_public.users(id) on delete cascade;
  end if;
end;
$$;
do $$
begin
  if to_regclass('app_public.family_discounts_pkey') is not null then
    alter index app_public.family_discounts_pkey rename to discounts_pkey;
  end if;
end;
$$;
do $$
begin
  if to_regclass('app_public.family_discounts_family_active') is not null then
    alter index app_public.family_discounts_family_active rename to discounts_payer_active;
  end if;
end;
$$;

do $$
begin
  if to_regclass('app_public.family_tax_exemptions') is not null then
    alter table app_public.family_tax_exemptions rename to tax_exemptions;
  end if;
end;
$$;
alter table app_public.tax_exemptions drop constraint if exists family_tax_exemptions_family_id_fkey;
do $$
begin
  if exists (select 1 from pg_attribute where attrelid = 'app_public.tax_exemptions'::regclass and attname = 'family_id' and not attisdropped) then
    alter table app_public.tax_exemptions rename column family_id to payer_id;
  end if;
end;
$$;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'app_public.tax_exemptions'::regclass and conname = 'tax_exemptions_payer_id_fkey') then
    alter table app_public.tax_exemptions
      add constraint tax_exemptions_payer_id_fkey foreign key (payer_id) references app_public.users(id) on delete cascade;
  end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'app_public.tax_exemptions'::regclass and conname = 'family_tax_exemptions_family_id_tax_rate_id_key') then
    alter table app_public.tax_exemptions
      rename constraint family_tax_exemptions_family_id_tax_rate_id_key to tax_exemptions_payer_id_tax_rate_id_key;
  end if;
end;
$$;
do $$
begin
  if to_regclass('app_public.family_tax_exemptions_pkey') is not null then
    alter index app_public.family_tax_exemptions_pkey rename to tax_exemptions_pkey;
  end if;
end;
$$;
do $$
begin
  if to_regclass('app_public.family_tax_exemptions_family') is not null then
    alter index app_public.family_tax_exemptions_family rename to tax_exemptions_payer;
  end if;
end;
$$;

-- A billing run's payer is the payer of its bill.
drop policy if exists select_monthly_billing_runs on app_public.monthly_billing_runs;
alter table app_public.monthly_billing_runs drop column if exists family_id;

-- Policies --------------------------------------------------------------------

drop policy if exists select_bills on app_public.bills;
create policy select_bills on app_public.bills for select using (
  app_public.current_user_role() = 'admin'
  or payer_id in (select app_public.current_user_visible_payer_ids())
);

drop policy if exists select_payments on app_public.payments;
create policy select_payments on app_public.payments for select using (
  app_public.current_user_role() = 'admin'
  or payer_id in (select app_public.current_user_visible_payer_ids())
);

drop policy if exists select_family_credits on app_public.credits;
do $$
begin
  if exists (select 1 from pg_policy where polrelid = 'app_public.credits'::regclass and polname = 'insert_family_credits') then
    alter policy insert_family_credits on app_public.credits rename to insert_credits;
  end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_policy where polrelid = 'app_public.credits'::regclass and polname = 'update_family_credits') then
    alter policy update_family_credits on app_public.credits rename to update_credits;
  end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_policy where polrelid = 'app_public.credits'::regclass and polname = 'delete_family_credits') then
    alter policy delete_family_credits on app_public.credits rename to delete_credits;
  end if;
end;
$$;
drop policy if exists select_credits on app_public.credits;
create policy select_credits on app_public.credits for select using (
  app_public.current_user_role() = 'admin'
  or payer_id in (select app_public.current_user_visible_payer_ids())
);

drop policy if exists select_family_discounts on app_public.discounts;
do $$
begin
  if exists (select 1 from pg_policy where polrelid = 'app_public.discounts'::regclass and polname = 'insert_family_discounts') then
    alter policy insert_family_discounts on app_public.discounts rename to insert_discounts;
  end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_policy where polrelid = 'app_public.discounts'::regclass and polname = 'update_family_discounts') then
    alter policy update_family_discounts on app_public.discounts rename to update_discounts;
  end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_policy where polrelid = 'app_public.discounts'::regclass and polname = 'delete_family_discounts') then
    alter policy delete_family_discounts on app_public.discounts rename to delete_discounts;
  end if;
end;
$$;
drop policy if exists select_discounts on app_public.discounts;
create policy select_discounts on app_public.discounts for select using (
  app_public.current_user_role() = 'admin'
  or payer_id in (select app_public.current_user_visible_payer_ids())
);

drop policy if exists select_family_tax_exemptions on app_public.tax_exemptions;
do $$
begin
  if exists (select 1 from pg_policy where polrelid = 'app_public.tax_exemptions'::regclass and polname = 'insert_family_tax_exemptions') then
    alter policy insert_family_tax_exemptions on app_public.tax_exemptions rename to insert_tax_exemptions;
  end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_policy where polrelid = 'app_public.tax_exemptions'::regclass and polname = 'update_family_tax_exemptions') then
    alter policy update_family_tax_exemptions on app_public.tax_exemptions rename to update_tax_exemptions;
  end if;
end;
$$;
do $$
begin
  if exists (select 1 from pg_policy where polrelid = 'app_public.tax_exemptions'::regclass and polname = 'delete_family_tax_exemptions') then
    alter policy delete_family_tax_exemptions on app_public.tax_exemptions rename to delete_tax_exemptions;
  end if;
end;
$$;
drop policy if exists select_tax_exemptions on app_public.tax_exemptions;
create policy select_tax_exemptions on app_public.tax_exemptions for select using (
  app_public.current_user_role() = 'admin'
  or payer_id in (select app_public.current_user_visible_payer_ids())
);

drop policy if exists select_family_credit_applications on app_public.credit_applications;
do $$
begin
  if exists (select 1 from pg_policy where polrelid = 'app_public.credit_applications'::regclass and polname = 'insert_family_credit_applications') then
    alter policy insert_family_credit_applications on app_public.credit_applications rename to insert_credit_applications;
  end if;
end;
$$;
drop policy if exists select_credit_applications on app_public.credit_applications;
create policy select_credit_applications on app_public.credit_applications for select using (
  app_public.current_user_role() = 'admin'
  or bill_id in (select id from app_public.bills)
);

drop policy if exists select_bill_adjustments on app_public.bill_adjustments;
create policy select_bill_adjustments on app_public.bill_adjustments for select using (
  app_public.current_user_role() = 'admin'
  or bill_id in (select id from app_public.bills)
);

drop policy if exists select_bill_line_items on app_public.bill_line_items;
create policy select_bill_line_items on app_public.bill_line_items for select using (
  app_public.current_user_role() = 'admin'
  or bill_id in (select id from app_public.bills)
);

drop policy if exists select_bill_notifications on app_public.bill_notifications;
create policy select_bill_notifications on app_public.bill_notifications for select using (
  app_public.current_user_role() = 'admin'
  or bill_id in (select id from app_public.bills)
);

drop policy if exists select_payment_allocations on app_public.payment_allocations;
create policy select_payment_allocations on app_public.payment_allocations for select using (
  app_public.current_user_role() = 'admin'
  or bill_id in (select id from app_public.bills)
  or payment_id in (select id from app_public.payments)
);

drop policy if exists select_refunds on app_public.refunds;
create policy select_refunds on app_public.refunds for select using (
  app_public.current_user_role() = 'admin'
  or payment_id in (select id from app_public.payments)
);

drop policy if exists select_monthly_billing_runs on app_public.monthly_billing_runs;
create policy select_monthly_billing_runs on app_public.monthly_billing_runs for select using (
  app_public.current_user_role() = 'admin'
  or bill_id in (select id from app_public.bills)
);

-- Billing functions -----------------------------------------------------------

drop function if exists app_public.get_effective_discount(uuid, date);
create or replace function app_public.get_effective_discount(p_payer_id uuid, p_on_date date) returns jsonb as $$
  select jsonb_build_object(
    'label', d.label,
    'discount_type', d.discount_type,
    'discount_value', d.discount_value,
    'applies_to', d.applies_to
  )
  from app_public.discounts d
  where d.payer_id = p_payer_id
    and d.is_active
    and d.effective_from <= p_on_date
    and (d.effective_until is null or d.effective_until >= p_on_date)
  order by d.created_at
  limit 1;
$$ language sql stable security definer set search_path to pg_catalog;

drop function if exists app_public.get_effective_tax_rate(uuid, date);
create or replace function app_public.get_effective_tax_rate(p_payer_id uuid, p_on_date date) returns jsonb as $$
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
      select 1 from app_public.tax_exemptions te
      where te.payer_id = p_payer_id
        and te.tax_rate_id = tr.id
        and te.effective_from <= p_on_date
        and (te.effective_until is null or te.effective_until >= p_on_date)
    )
  order by tr.created_at
  limit 1;
$$ language sql stable security definer set search_path to pg_catalog;

drop function if exists app_public.monthly_billing_eligible(date);
create or replace function app_public.monthly_billing_eligible(p_billing_month date)
returns table(
  student_id uuid, student_rate_id uuid, rate_cents integer, lesson_duration_minutes integer,
  location_type app_public.location_type, schedule_id uuid, day_of_week smallint,
  local_start_time time without time zone, timezone text, starts_on date, ends_on date
) as $$
  select
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
    rs.ends_on
  from app_public.recurring_schedules rs
  join app_public.student_rates sr
    on sr.id = rs.student_rate_id
    and sr.billing_model = 'monthly_prepaid'
  where rs.active
    and rs.starts_on <= (p_billing_month + interval '1 month - 1 day')::date
    and (rs.ends_on is null or rs.ends_on >= p_billing_month)
$$ language sql stable security definer set search_path to pg_catalog;

create or replace function app_public.create_monthly_bill_line_items(
  p_bill_id uuid, p_student_id uuid, p_billing_month date, p_due_date date
)
returns table(
  student_id uuid, line_type text, description text, quantity integer,
  unit_price_cents integer, amount_cents integer, schedule_id uuid
) as $$
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
  v_payer_id uuid;
  v_effective_rate_cents integer;
  v_line_tax integer;
begin
  select to_char(p_billing_month, 'FMMonth') into v_month_name;
  select to_char(p_billing_month, 'YYYY') into v_year;

  select b.payer_id into v_payer_id from app_public.bills b where b.id = p_bill_id;

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
        coalesce(rate.rate_cents, e.rate_cents) as effective_rate_cents
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
  v_discount := app_public.get_effective_discount(v_payer_id, p_billing_month);
  if v_discount is not null and (v_discount->>'applies_to') in ('all', 'tuition') then
    if (v_discount->>'discount_type') = 'percentage' then
      v_discount_cents := round(v_subtotal * (v_discount->>'discount_value')::numeric / 100.0)::integer;
    else
      v_discount_cents := least((v_discount->>'discount_value')::integer, v_subtotal);
    end if;
  end if;

  -- Apply tax (snapshotted as jsonb on bill)
  v_tax := app_public.get_effective_tax_rate(v_payer_id, p_billing_month);
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
$$ language plpgsql volatile security definer set search_path to pg_catalog;

create or replace function app_public.issue_monthly_bills(p_billing_month date) returns jsonb as $$
declare
  v_due_date date;
  v_student record;
  v_payer_id uuid;
  v_bill_id uuid;
  v_line_count integer;
  v_students_processed integer := 0;
  v_bills_created integer := 0;
  v_bills_skipped integer := 0;
  v_errors integer := 0;
  v_error_detail text;
begin
  if p_billing_month is null or p_billing_month <> date_trunc('month', p_billing_month)::date then
    raise exception 'p_billing_month must be the first day of a month';
  end if;

  -- Due on the 5th of the billing month.
  v_due_date := p_billing_month + 4;

  for v_student in
    select distinct e.student_id
    from app_public.monthly_billing_eligible(p_billing_month) e
    order by e.student_id
  loop
    v_students_processed := v_students_processed + 1;

    if exists (
      select 1 from app_public.monthly_billing_runs
      where student_id = v_student.student_id
        and billing_month = p_billing_month
        and status = 'completed'
    ) then
      v_bills_skipped := v_bills_skipped + 1;
      continue;
    end if;

    -- One bill per student: a draft for student A must not block student B.
    if exists (
      select 1 from app_public.bills b
      join app_public.bill_line_items bli on bli.bill_id = b.id
      where b.billing_period_start = p_billing_month
        and b.status = 'draft'
        and bli.student_id = v_student.student_id
    ) then
      v_bills_skipped := v_bills_skipped + 1;
      continue;
    end if;

    -- A failed run is cleared so the student can be retried.
    delete from app_public.monthly_billing_runs
    where student_id = v_student.student_id
      and billing_month = p_billing_month
      and status = 'failed';

    begin
      v_payer_id := app_public.payer_id_for_student(v_student.student_id);

      insert into app_public.bills (
        payer_id, bill_number, status,
        billing_period_start, billing_period_end, due_date,
        subtotal_cents, discount_cents, tax_cents, total_cents
      ) values (
        v_payer_id, app_public.next_bill_number(), 'draft',
        p_billing_month,
        (p_billing_month + interval '1 month - 1 day')::date,
        v_due_date,
        0, 0, 0, 0
      ) returning id into v_bill_id;

      perform app_public.create_monthly_bill_line_items(
        v_bill_id, v_student.student_id, p_billing_month, v_due_date
      );

      select count(*) into v_line_count
      from app_public.bill_line_items
      where bill_id = v_bill_id;

      if v_line_count = 0 then
        update app_public.bills
        set status = 'cancelled', cancelled_at = now()
        where id = v_bill_id;
        continue;
      end if;

      update app_public.bills
      set status = 'issued', issued_at = now()
      where id = v_bill_id;

      insert into app_public.monthly_billing_runs (
        student_id, billing_month, bill_id, due_date, status
      ) values (
        v_student.student_id, p_billing_month, v_bill_id, v_due_date, 'completed'
      );

      v_bills_created := v_bills_created + 1;

      perform app_public.enqueue_monthly_lesson_generation(v_student.student_id, p_billing_month);

    exception when others then
      get stacked diagnostics v_error_detail = message_text;
      v_errors := v_errors + 1;
      insert into app_public.monthly_billing_runs (
        student_id, billing_month, due_date, status, error
      ) values (
        v_student.student_id, p_billing_month, v_due_date, 'failed',
        left(v_student.student_id || ': ' || v_error_detail, 4000)
      )
      on conflict (student_id, billing_month)
      do update set status = 'failed', error = excluded.error;
    end;
  end loop;

  return jsonb_build_object(
    'billing_month', to_char(p_billing_month, 'YYYY-MM-DD'),
    'due_date', to_char(v_due_date, 'YYYY-MM-DD'),
    'students_processed', v_students_processed,
    'bills_created', v_bills_created,
    'bills_skipped', v_bills_skipped,
    'errors', v_errors
  );
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

-- The bill for one single-booking lesson. The price is the student's rate for
-- the lesson's location; a lesson under any other billing model, or with no
-- rate, gets no bill here (monthly prepaid lessons are billed per month).
drop function if exists app_public.create_single_booking_obligation(uuid, integer);
create or replace function app_public.create_single_booking_obligation(p_lesson_id uuid)
returns uuid as $$
declare
  v_student_id uuid;
  v_location app_public.location_type;
  v_rate_cents integer;
  v_payer_id uuid;
  v_bill_id uuid;
  v_lesson_date date;
begin
  select student_id, location_type, (scheduled_at at time zone 'America/Chicago')::date
    into v_student_id, v_location, v_lesson_date
    from app_public.lessons
   where id = p_lesson_id
     for update;
  if v_student_id is null then
    raise exception 'Lesson not found' using errcode = 'NTFND';
  end if;

  if not (
    app_public.current_user_role() = 'admin'
    or v_student_id = app_public.current_user_id()
    or v_student_id in (select app_public.current_user_family_member_ids())
  ) then
    raise insufficient_privilege using message = 'Not authorized to create this booking obligation';
  end if;

  select sr.rate_cents into v_rate_cents
    from app_public.student_rates sr
   where sr.student_id = v_student_id
     and sr.location_type = v_location
     and sr.billing_model = 'single_booking';
  if v_rate_cents is null then
    return null;
  end if;

  select b.id
    into v_bill_id
    from app_public.bill_line_items bli
    join app_public.bills b on b.id = bli.bill_id
   where bli.lesson_id = p_lesson_id
   limit 1;
  if v_bill_id is not null then
    return v_bill_id;
  end if;

  v_payer_id := app_public.payer_id_for_student(v_student_id);
  insert into app_public.bills (
    payer_id, bill_number, status, billing_period_start,
    billing_period_end, due_date, subtotal_cents, discount_cents,
    tax_cents, total_cents
  ) values (
    v_payer_id, app_public.next_bill_number(), 'draft', v_lesson_date, v_lesson_date,
    v_lesson_date, v_rate_cents, 0, 0, v_rate_cents
  ) returning id into v_bill_id;

  insert into app_public.bill_line_items (
    bill_id, student_id, line_type, description, quantity,
    unit_price_cents, amount_cents, lesson_id
  ) values (
    v_bill_id, v_student_id, 'single_booking', 'Single lesson booking',
    1, v_rate_cents, v_rate_cents, p_lesson_id
  );

  update app_public.bills
     set status = 'issued', issued_at = now()
   where id = v_bill_id;

  return v_bill_id;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

drop function if exists app_public.settle_single_booking_cancellation(uuid, integer, boolean);
-- Cancels a lesson's open single-booking bill; a captured deposit becomes a
-- credit for the payer.
create or replace function app_public.settle_single_booking_cancellation(
  p_lesson_id uuid, p_captured_deposit_cents integer default 0
) returns void as $$
declare
  v_student_id uuid;
  v_payer_id uuid;
  v_bill_id uuid;
  v_reason text;
begin
  select student_id into v_student_id
    from app_public.lessons
   where id = p_lesson_id;
  if v_student_id is null then
    raise exception 'Lesson not found' using errcode = 'NTFND';
  end if;
  if not (
    app_public.current_user_role() = 'admin'
    or v_student_id = app_public.current_user_id()
    or v_student_id in (select app_public.current_user_family_member_ids())
  ) then
    raise insufficient_privilege using message = 'Not authorized to settle this booking';
  end if;

  select b.id, b.payer_id into v_bill_id, v_payer_id
    from app_public.bill_line_items bli
    join app_public.bills b on b.id = bli.bill_id
   where bli.lesson_id = p_lesson_id
   limit 1;
  if v_bill_id is null then
    return;
  end if;

  update app_public.bills
     set status = case when status in ('draft', 'issued') then 'cancelled' else status end,
         cancelled_at = case when status in ('draft', 'issued') then now() else cancelled_at end
   where id = v_bill_id;

  if p_captured_deposit_cents > 0 then
    v_reason := 'Captured deposit for cancelled single booking ' || p_lesson_id::text;
    insert into app_public.credits (payer_id, student_id, amount_cents, reason, created_by)
    select v_payer_id, v_student_id, p_captured_deposit_cents, v_reason, app_public.current_user_id()
    where not exists (
      select 1 from app_public.credits
       where payer_id = v_payer_id and reason = v_reason
    );
  end if;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

-- Ledger triggers -------------------------------------------------------------

create or replace function app_private.tg_bills__immutable_after_issue() returns trigger as $$
begin
  if OLD.status <> 'draft' and (
    NEW.payer_id is distinct from OLD.payer_id
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

create or replace function app_private.tg_credit_applications__consume() returns trigger as $$
begin
  update app_public.credits
     set consumed_at = coalesce(consumed_at, now())
   where id = NEW.credit_id
     and consumed_at is null
     and (select coalesce(sum(amount_cents), 0)
            from app_public.credit_applications
           where credit_id = NEW.credit_id)
         >= amount_cents;
  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

create or replace function app_private.tg_credit_applications__validate() returns trigger as $$
declare
  v_credit_payer uuid;
  v_credit_amount integer;
  v_bill_payer uuid;
  v_bill_status app_public.bill_status;
  v_applied integer;
  v_bill_total integer;
  v_bill_adjustments integer;
  v_bill_credits integer;
  v_bill_payments integer;
begin
  select payer_id, amount_cents into v_credit_payer, v_credit_amount
    from app_public.credits where id = NEW.credit_id for update;
  select payer_id, status, total_cents into v_bill_payer, v_bill_status, v_bill_total
    from app_public.bills where id = NEW.bill_id for update;
  select coalesce(sum(amount_cents), 0) into v_bill_adjustments from app_public.bill_adjustments where bill_id = NEW.bill_id;
  select coalesce(sum(amount_cents), 0) into v_bill_credits from app_public.credit_applications where bill_id = NEW.bill_id and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  select coalesce(sum(amount_cents), 0) into v_bill_payments from app_public.payment_allocations where bill_id = NEW.bill_id;
  if v_credit_payer is null or v_bill_payer is null
     or v_credit_payer <> v_bill_payer then
    raise exception 'Credit and bill must belong to the same payer';
  end if;
  if v_bill_status not in ('issued', 'paid') then
    raise exception 'Credits can only be applied to issued bills';
  end if;
  select coalesce(sum(amount_cents), 0) into v_applied
    from app_public.credit_applications
   where credit_id = NEW.credit_id
     and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_applied + NEW.amount_cents > v_credit_amount then
    raise exception 'Credit applications exceed the credit amount';
  end if;
  if NEW.amount_cents > greatest(0, v_bill_total + v_bill_adjustments - v_bill_credits - v_bill_payments) then
    raise exception 'Credit application exceeds the bill outstanding balance';
  end if;
  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

create or replace function app_private.tg_payment_allocations__validate() returns trigger as $$
declare
  v_payment_payer uuid;
  v_payment_amount integer;
  v_bill_payer uuid;
  v_bill_status app_public.bill_status;
  v_allocated integer;
  v_bill_total integer;
  v_bill_adjustments integer;
  v_bill_credits integer;
  v_bill_payments integer;
begin
  select payer_id, amount_cents into v_payment_payer, v_payment_amount
    from app_public.payments where id = NEW.payment_id for update;
  select payer_id, status, total_cents into v_bill_payer, v_bill_status, v_bill_total
    from app_public.bills where id = NEW.bill_id for update;
  select coalesce(sum(amount_cents), 0) into v_bill_adjustments from app_public.bill_adjustments where bill_id = NEW.bill_id;
  select coalesce(sum(amount_cents), 0) into v_bill_credits from app_public.credit_applications where bill_id = NEW.bill_id;
  select coalesce(sum(amount_cents), 0) into v_bill_payments from app_public.payment_allocations where bill_id = NEW.bill_id and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_payment_payer is null or v_bill_payer is null
     or v_payment_payer <> v_bill_payer then
    raise exception 'Payment and bill must belong to the same payer';
  end if;
  if v_bill_status not in ('issued', 'paid') then
    raise exception 'Payments can only be allocated to issued bills';
  end if;

  select coalesce(sum(amount_cents), 0) into v_allocated
    from app_public.payment_allocations
   where payment_id = NEW.payment_id
     and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_allocated + NEW.amount_cents > v_payment_amount then
    raise exception 'Payment allocations exceed the payment amount';
  end if;
  if NEW.amount_cents > greatest(0, v_bill_total + v_bill_adjustments - v_bill_credits - v_bill_payments) then
    raise exception 'Payment allocation exceeds the bill outstanding balance';
  end if;
  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

-- The audit log is append-only and must outlive the users it names. A foreign
-- key with "on delete set null" updates audit rows, which the append-only
-- trigger refuses, so no user with financial history could be deleted.
alter table app_public.financial_audit_events
  drop constraint if exists financial_audit_events_actor_id_fkey;
comment on column app_public.financial_audit_events.actor_id is
  'The user who made the change. Not a foreign key: the id stays after that user is deleted.';
