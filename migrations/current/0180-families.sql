drop function if exists app_public.transfer_family_billing_contact(uuid, uuid);
drop function if exists app_public.transfer_family_ownership(uuid, uuid);
drop function if exists app_public.delete_family(uuid);
drop function if exists app_public.remove_from_family(uuid, uuid);
drop function if exists app_public.families_current_user_is_billing_contact(app_public.families);
drop function if exists app_public.families_current_user_is_owner(app_public.families);
drop function if exists app_public.accept_invitation_to_family(uuid, text) cascade;
drop function if exists app_public.get_family_for_invitation(uuid, text) cascade;
drop function if exists app_public.family_for_invitation(uuid, text) cascade;
drop function if exists app_private.create_qr_invite(uuid) cascade;
drop function if exists app_public.invite_user_to_family(uuid, uuid) cascade;
drop function if exists app_public.invite_to_family(uuid, citext, citext) cascade;
drop function if exists app_public.current_user_invited_family_ids() cascade;
drop function if exists app_public.current_user_member_family_ids() cascade;
drop table if exists app_public.family_invitations;
drop table if exists app_public.family_memberships;
drop table if exists app_public.families cascade;

--------------------------------------------------------------------------------

create table app_public.families (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);
alter table app_public.families enable row level security;

grant select, update(name, slug) on app_public.families to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create table app_public.family_memberships (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families on delete cascade,
  user_id uuid not null references app_public.users on delete cascade,
  is_owner boolean not null default false,
  is_billing_contact boolean not null default false,
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);
alter table app_public.family_memberships enable row level security;

create index on app_public.family_memberships (user_id);

grant select on app_public.family_memberships to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create table app_public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families on delete cascade,
  code text,
  user_id uuid references app_public.users on delete cascade,
  email citext,
  expires_at timestamptz,
  check (user_id is not null or email is not null or code is not null),
  unique (family_id, user_id),
  unique (family_id, email)
);
alter table app_public.family_invitations enable row level security;

create index on app_public.family_invitations(user_id);
-- grant select on app_public.family_invitations to :DATABASE_VISITOR;

--------------------------------------------------------------------------------
create function app_public.current_user_member_family_ids() returns setof uuid as $$
  select family_id from app_public.family_memberships
    where user_id = app_public.current_user_id();
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.current_user_invited_family_ids() returns setof uuid as $$
  select family_id from app_public.family_invitations
    where user_id = app_public.current_user_id();
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

create policy select_member on app_public.families
  for select using (id in (select app_public.current_user_member_family_ids()));

create policy select_invited on app_public.families
  for select using (id in (select app_public.current_user_invited_family_ids()));

create policy select_member on app_public.family_memberships
  for select using (family_id in (select app_public.current_user_member_family_ids()));

create policy select_invited on app_public.family_memberships
  for select using (family_id in (select app_public.current_user_invited_family_ids()));

--------------------------------------------------------------------------------
create function app_public.create_family(slug citext, name text) returns app_public.families as $$
declare
  v_org app_public.families;
begin
  insert into app_public.families (slug, name) values (slug, name) returning * into v_org;
  insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
    values(v_org.id, app_public.current_user_id(), true, true);
  return v_org;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.invite_to_family(family_id uuid, username citext = null, email citext = null)
  returns void as $$
declare
  v_code text;
  v_user app_public.users;
begin
  -- Are we allowed to add this person
  -- Are we logged in
  if app_public.current_user_id() is null then
    raise exception 'You must log in to invite a user' using errcode = 'LOGIN';
  end if;

  select * into v_user from app_public.users where users.username = invite_to_family.username;

  -- Are we the owner of this family
  if not exists(
    select 1 from app_public.family_memberships
      where family_memberships.family_id = invite_to_family.family_id
      and family_memberships.user_id = app_public.current_user_id()
      and is_owner is true
  ) then
    raise exception 'You''re not the owner of this family' using errcode = 'DNIED';
  end if;

  if v_user.id is not null and exists(
    select 1 from app_public.family_memberships
      where family_memberships.family_id = invite_to_family.family_id
      and family_memberships.user_id = v_user.id
  ) then
    raise exception 'Cannot invite someone who is already a member' using errcode = 'ISMBR';
  end if;

  if email is not null then
    v_code = encode(gen_random_bytes(7), 'hex');
  end if;

  if v_user.id is not null and not v_user.is_verified then
    raise exception 'The user you attempted to invite has not verified their account' using errcode = 'VRFY2';
  end if;

  if v_user.id is null and email is null then
    raise exception 'Could not find person to invite' using errcode = 'NTFND';
  end if;

  -- Invite the user
  insert into app_public.family_invitations(family_id, user_id, email, code)
    values (invite_to_family.family_id, v_user.id, email, v_code);
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

create function app_private.create_qr_invite(family_id uuid)
  returns app_public.family_invitations as $$
declare
  v_invitation app_public.family_invitations;
begin
  insert into app_public.family_invitations(family_id, code, expires_at)
    values (
      create_qr_invite.family_id,
      encode(gen_random_bytes(12), 'hex'),
      now() + interval '24 hours'
    )
    returning * into v_invitation;
  return v_invitation;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.family_for_invitation(invitation_id uuid, code text = null)
  returns app_public.families as $$
declare
  v_invitation app_public.family_invitations;
  v_family app_public.families;
begin
  if app_public.current_user_id() is null then
    raise exception 'You must log in to accept an invitation' using errcode = 'LOGIN';
  end if;

  select * into v_invitation from app_public.family_invitations where id = invitation_id;

  if v_invitation is null then
    raise exception 'We could not find that invitation' using errcode = 'NTFND';
  end if;

  if v_invitation.expires_at is not null and v_invitation.expires_at < now() then
    raise exception 'This invitation has expired' using errcode = 'DNIED';
  end if;

  if v_invitation.user_id is not null then
    if v_invitation.user_id is distinct from app_public.current_user_id() then
      raise exception 'That invitation is not for you' using errcode = 'DNIED';
    end if;
  else
    if v_invitation.code is distinct from code then
      raise exception 'Incorrect invitation code' using errcode = 'DNIED';
    end if;
  end if;

  select * into v_family from app_public.families where id = v_invitation.family_id;

  return v_family;
end;
$$ language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.accept_invitation_to_family(invitation_id uuid, code text = null)
  returns void as $$
declare
  v_family app_public.families;
begin
  v_family = app_public.family_for_invitation(invitation_id, code);

  -- Accept the user into the family
  insert into app_public.family_memberships (family_id, user_id)
    values(v_family.id, app_public.current_user_id())
    on conflict do nothing;

  -- Delete the invitation
  delete from app_public.family_invitations where id = invitation_id;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

--------------------------------------------------------------------------------

create trigger _500_send_email after insert on app_public.family_invitations
  for each row execute procedure app_private.tg__add_job('family_invitations__send_invite');

--------------------------------------------------------------------------------

create function app_public.families_current_user_is_owner(
  org app_public.families
) returns boolean as $$
  select exists(
    select 1
    from app_public.family_memberships
    where family_id = org.id
    and user_id = app_public.current_user_id()
    and is_owner is true
  )
$$ language sql stable;

create function app_public.families_current_user_is_billing_contact(
  org app_public.families
) returns boolean as $$
  select exists(
    select 1
    from app_public.family_memberships
    where family_id = org.id
    and user_id = app_public.current_user_id()
    and is_billing_contact is true
  )
$$ language sql stable;

create policy update_owner on app_public.families for update using (exists(
  select 1
  from app_public.family_memberships
  where family_id = families.id
  and user_id = app_public.current_user_id()
  and is_owner is true
));

create function app_public.remove_from_family(
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

  if (v_my_membership is null) then
    -- I'm not a member of that family
    return;
  elsif v_my_membership.is_owner then
    if remove_from_family.user_id <> app_public.current_user_id() then
      -- Delete it
    else
      -- Need to transfer ownership before I can leave
      return;
    end if;
  elsif v_my_membership.user_id = user_id then
    -- Delete it
  else
    -- Not allowed to delete it
    return;
  end if;

  if v_my_membership.is_billing_contact then
    update app_public.family_memberships
      set is_billing_contact = false
      where id = v_my_membership.id
      returning * into v_my_membership;
    update app_public.family_memberships
      set is_billing_contact = true
      where family_memberships.family_id = remove_from_family.family_id
      and family_memberships.is_owner;
  end if;

  delete from app_public.family_memberships
    where family_memberships.family_id = remove_from_family.family_id
    and family_memberships.user_id = remove_from_family.user_id;

end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

--------------------------------------------------------------------------------

create function app_public.tg_users__deletion_family_checks_and_actions() returns trigger as $$
begin
  -- Check they're not an family owner
  if exists(
    select 1
    from app_public.family_memberships
    where user_id = app_public.current_user_id()
    and is_owner is true
  ) then
    raise exception 'You cannot delete your account until you are not the owner of any families.' using errcode = 'OWNER';
  end if;

  -- Reassign billing contact status back to the family owner
  update app_public.family_memberships
    set is_billing_contact = true
    where is_owner = true
    and family_id in (
      select family_id
      from app_public.family_memberships my_memberships
      where my_memberships.user_id = app_public.current_user_id()
      and is_billing_contact is true
    );

  return old;
end;
$$ language plpgsql;

create trigger _500_deletion_family_checks_and_actions
  before delete
  on app_public.users
  for each row
  when (app_public.current_user_id() is not null)
  execute procedure app_public.tg_users__deletion_family_checks_and_actions();

create function app_public.delete_family(family_id uuid) returns void as $$
begin
  if exists(
    select 1
    from app_public.family_memberships
    where user_id = app_public.current_user_id()
    and family_memberships.family_id = delete_family.family_id
    and is_owner is true
  ) then
    delete from app_public.families where id = family_id;
  end if;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

create function app_public.transfer_family_ownership(
  family_id uuid,
  user_id uuid
) returns app_public.families as $$
declare
 v_org app_public.families;
begin
  if exists(
    select 1
    from app_public.family_memberships
    where family_memberships.user_id = app_public.current_user_id()
    and family_memberships.family_id = transfer_family_ownership.family_id
    and is_owner is true
  ) then
    update app_public.family_memberships
      set is_owner = true
      where family_memberships.family_id = transfer_family_ownership.family_id
      and family_memberships.user_id = transfer_family_ownership.user_id;
    if found then
      update app_public.family_memberships
        set is_owner = false
        where family_memberships.family_id = transfer_family_ownership.family_id
        and family_memberships.user_id = app_public.current_user_id();

      select * into v_org from app_public.families where id = family_id;
      return v_org;
    end if;
  end if;
  return null;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

create function app_public.transfer_family_billing_contact(
  family_id uuid,
  user_id uuid
) returns app_public.families as $$
declare
 v_org app_public.families;
begin
  if exists(
    select 1
    from app_public.family_memberships
    where family_memberships.user_id = app_public.current_user_id()
    and family_memberships.family_id = transfer_family_billing_contact.family_id
    and is_owner is true
  ) then
    update app_public.family_memberships
      set is_billing_contact = true
      where family_memberships.family_id = transfer_family_billing_contact.family_id
      and family_memberships.user_id = transfer_family_billing_contact.user_id;
    if found then
      update app_public.family_memberships
        set is_billing_contact = false
        where family_memberships.family_id = transfer_family_billing_contact.family_id
        and family_memberships.user_id <> transfer_family_billing_contact.user_id
        and is_billing_contact = true;

      select * into v_org from app_public.families where id = family_id;
      return v_org;
    end if;
  end if;
  return null;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

--------------------------------------------------------------------------------
-- Bridge function for RLS: returns user IDs of all members in the current
-- user's families (excluding self). Used by app table RLS policies so
-- family members can see each other's data.
create function app_public.current_user_family_member_ids() returns setof uuid as $$
  select fm.user_id from app_public.family_memberships fm
    where fm.family_id in (select app_public.current_user_member_family_ids())
    and fm.user_id <> app_public.current_user_id();
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;
