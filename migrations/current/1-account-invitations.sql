/*
 * Account invitations: staff create an account for an existing student or parent, and the
 * invitation email logs them in.
 *
 * An account invitation is a family_invitations row with no family and a user_id: the account
 * already exists, and the row holds who sent it, the optional message, and when the link
 * expires. When staff pick a family, the account joins it at once, so the row still has no
 * family. A row with a family stays what it was: an offer to join that family.
 *
 * The invited account is unclaimed until its first address is verified. The secret in the
 * email is that address's verification token, so following the link proves the address,
 * verifies it, and starts a session. An unclaimed account has no password and no linked
 * login, so the token is the only way in.
 *
 * Reruns safely: `graphile-migrate watch` applies this file after each edit, and the release
 * commit applies it again on a database that already has it.
 */

alter table app_public.family_invitations
  alter column family_id drop not null,
  add column if not exists invited_by uuid references app_public.users on delete set null,
  add column if not exists message text,
  add column if not exists created_at timestamptz not null default now();

alter table app_public.family_invitations
  drop constraint if exists family_invitations_message_length,
  add constraint family_invitations_message_length check (length(message) <= 2000),
  drop constraint if exists family_invitations_account_has_user,
  add constraint family_invitations_account_has_user check (family_id is not null or user_id is not null);

create unique index if not exists uniq_family_invitations_account
  on app_public.family_invitations (user_id) where family_id is null;

create index if not exists idx_family_invitations_invited_by
  on app_public.family_invitations (invited_by);

-- The invited person reads their own account invitation: onboarding shows its message.
drop policy if exists select_own_account_invitation on app_public.family_invitations;
create policy select_own_account_invitation on app_public.family_invitations for select
  using (family_id is null and user_id = app_public.current_user_id());

-- Joining a family needs a family: an account invitation is never accepted this way.
create or replace function app_public.family_for_invitation(invitation_id uuid, code text = null)
  returns app_public.families as $$
declare
  v_invitation app_public.family_invitations;
  v_family app_public.families;
begin
  if app_public.current_user_id() is null then
    raise exception 'You must log in to accept an invitation' using errcode = 'LOGIN';
  end if;

  select * into v_invitation from app_public.family_invitations
    where id = invitation_id and family_id is not null;

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

--------------------------------------------------------------------------------
-- Usernames

/*
 * A free username made from a person's name: accents removed, leading non-letters dropped, other runs of
 * non-alphanumerics turned into `_`, cut to fit app_public.username, and a number appended
 * when the name is taken. A name with fewer than three usable characters becomes `user`.
 */
create or replace function app_private.unique_username(p_seed text) returns citext as $$
declare
  v_base text;
  v_username citext;
begin
  -- Decompose accented letters and drop the marks, so "Zoë" gives "Zoe", not "Zo_".
  v_base := regexp_replace(normalize(coalesce(p_seed, ''), nfd), '[̀-ͯ]', '', 'g');
  v_base := regexp_replace(v_base, '^[^a-z]+', '', 'gi');
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '_', 'gi');
  v_base := left(v_base, 58);
  if length(v_base) < 3 then
    v_base := 'user';
  end if;
  select candidate into v_username
    from generate_series(0, 1000) i,
      lateral (select (case when i = 0 then v_base else v_base || i::text end)::citext as candidate) c
    where not exists (select 1 from app_public.users where users.username = c.candidate)
    order by i
    limit 1;
  return v_username;
end;
$$ language plpgsql volatile set search_path to pg_catalog, public, pg_temp;

create or replace function app_private.register_user(
  f_service character varying,
  f_identifier character varying,
  f_profile json,
  f_auth_details json,
  f_email_is_verified boolean default false
) returns app_public.users as $$
declare
  v_user app_public.users;
  v_user_authentication_id uuid;
begin
  v_user = app_private.really_create_user(
    username => app_private.unique_username(
      coalesce(f_profile ->> 'username', f_profile ->> 'name', 'user')
    ),
    email => f_profile ->> 'email',
    email_is_verified => f_email_is_verified,
    name => f_profile ->> 'name',
    avatar_url => f_profile ->> 'avatar_url'
  );

  -- Insert the user’s private account data (e.g. OAuth tokens)
  insert into app_public.user_authentications (user_id, service, identifier, details) values
    (v_user.id, f_service, f_identifier, f_profile) returning id into v_user_authentication_id;
  insert into app_private.user_authentication_secrets (user_authentication_id, details) values
    (v_user_authentication_id, f_auth_details);

  return v_user;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

--------------------------------------------------------------------------------
-- Verification email

/*
 * A new unverified address gets a verification email, except the first address of an invited
 * account: the invitation email carries that address's token.
 */
create or replace function app_private.tg_user_emails__send_verification() returns trigger as $$
begin
  if exists (
    select 1
      from app_public.family_invitations i
      join app_public.users u on u.id = i.user_id
      where i.user_id = NEW.user_id and i.family_id is null and not u.is_verified
  ) then
    return NEW;
  end if;
  perform graphile_worker.add_job('user_emails__send_verification', json_build_object('id', NEW.id));
  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

drop trigger if exists _900_send_verification_email on app_public.user_emails;
create trigger _900_send_verification_email
  after insert on app_public.user_emails
  for each row
  when (NEW.is_verified is false)
  execute procedure app_private.tg_user_emails__send_verification();

--------------------------------------------------------------------------------
-- Sending and resending

/*
 * Staff create an account for a student or parent and email it a login link. The account
 * exists at once, so staff can add lessons and rates before the person logs in. With a family,
 * the account joins it now. An email that any account already holds, verified or not, is
 * refused with EMTKN.
 */
drop function if exists app_public.invite_account(text, citext, app_public.user_role, uuid, text);
create function app_public.invite_account(
  p_name text,
  p_email citext,
  p_role app_public.user_role,
  p_family_id uuid default null,
  p_message text default null
) returns app_public.users as $$
declare
  v_user app_public.users;
  v_email_id uuid;
begin
  if app_public.current_user_role() is null
    or app_public.current_user_role() not in ('admin', 'teacher') then
    raise exception 'Only staff can invite people' using errcode = 'DNIED';
  end if;
  if p_role not in ('student', 'parent') then
    raise exception 'Invite a student or a parent' using errcode = 'DNIED';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'A name is required' using errcode = 'DNIED';
  end if;

  -- Two invitations to one address would both pass the check below without this lock.
  perform pg_advisory_xact_lock(hashtext(lower(p_email::text)));
  if exists (select 1 from app_public.user_emails where email = p_email) then
    raise exception 'An account already uses that email address' using errcode = 'EMTKN';
  end if;

  v_user := app_private.really_create_user(
    username => app_private.unique_username(p_name),
    name => trim(p_name),
    avatar_url => null,
    email_is_verified => false
  );
  update app_public.users set role = p_role where id = v_user.id returning * into v_user;

  -- The invitation goes in before the address, so the address's trigger sees it and sends
  -- no separate verification email. Its insert trigger queues the invitation email.
  insert into app_public.family_invitations (user_id, invited_by, message, expires_at)
    values (v_user.id, app_public.current_user_id(), nullif(trim(p_message), ''), now() + interval '30 days');

  insert into app_public.user_emails (user_id, email) values (v_user.id, p_email)
    returning id into v_email_id;
  -- The verification token is a login credential here, so it gets the magic link's length.
  update app_private.user_email_secrets
    set verification_token = encode(gen_random_bytes(32), 'hex')
    where user_email_id = v_email_id;

  if p_family_id is not null then
    perform app_private.join_family(p_family_id, v_user.id);
  end if;

  return v_user;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

grant execute on function app_public.invite_account(text, citext, app_public.user_role, uuid, text) to :DATABASE_VISITOR;

/* A new link for an unclaimed account: a new token, 30 more days, and the email again. */
drop function if exists app_public.resend_account_invitation(uuid);
create function app_public.resend_account_invitation(p_invitation_id uuid) returns void as $$
declare
  v_user_id uuid;
begin
  if app_public.current_user_role() is null
    or app_public.current_user_role() not in ('admin', 'teacher') then
    raise exception 'Only staff can resend invitations' using errcode = 'DNIED';
  end if;

  update app_public.family_invitations i
    set expires_at = now() + interval '30 days'
    from app_public.users u
    where i.id = p_invitation_id and i.family_id is null and u.id = i.user_id and not u.is_verified
    returning i.user_id into v_user_id;
  if v_user_id is null then
    raise exception 'No pending invitation to resend' using errcode = 'NTFND';
  end if;

  update app_private.user_email_secrets s
    set verification_token = encode(gen_random_bytes(32), 'hex')
    from app_public.user_emails e
    where s.user_email_id = e.id and e.user_id = v_user_id and not e.is_verified;

  perform graphile_worker.add_job('family_invitations__send_invite', json_build_object('id', p_invitation_id));
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

grant execute on function app_public.resend_account_invitation(uuid) to :DATABASE_VISITOR;

--------------------------------------------------------------------------------
-- Claiming

/*
 * Follows an invitation link: verifies the invited address and returns its account, or null
 * when the link is wrong, expired, or already used. Only an unclaimed account can be claimed.
 */
create or replace function app_private.claim_account_invitation(p_invitation_id uuid, p_token text)
  returns app_public.users as $$
declare
  v_email_id uuid;
  v_user app_public.users;
begin
  select e.id into v_email_id
    from app_public.family_invitations i
    join app_public.users u on u.id = i.user_id
    join app_public.user_emails e on e.user_id = i.user_id
    join app_private.user_email_secrets s on s.user_email_id = e.id
    where i.id = p_invitation_id
      and i.family_id is null
      and i.expires_at > now()
      and not u.is_verified
      and not e.is_verified
      and s.verification_token = p_token
    for update of s;
  if v_email_id is null then
    return null;
  end if;

  update app_private.user_email_secrets set verification_token = null where user_email_id = v_email_id;
  update app_public.user_emails
    set
      is_verified = true,
      is_primary = is_primary or not exists (
        select 1 from app_public.user_emails other
          where other.user_id = user_emails.user_id and other.is_primary
      )
    where id = v_email_id;

  select u.* into v_user
    from app_public.users u
    join app_public.user_emails e on e.user_id = u.id
    where e.id = v_email_id;
  return v_user;
end;
$$ language plpgsql volatile strict security definer set search_path to pg_catalog, public, pg_temp;
