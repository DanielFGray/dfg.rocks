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
