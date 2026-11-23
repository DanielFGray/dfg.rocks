--! Previous: sha1:0e15570b228cdf1a3f06d50a70c84ac37017b5ba
--! Hash: sha1:7ab3da7293754b9ee4b0435b555a34339c4d065a

--! split: 1-account-invitations.sql
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

--! split: 2-student-profiles.sql
/*
 * Student profiles: what a student told us at onboarding. student_profiles holds one row per
 * account with the free-text background; student_instruments holds one row per instrument the
 * student wants to learn, with how long they have played it.
 *
 * Instruments are the contact form's values (shared/contactOptions.ts), so an inquiry and a
 * profile use the same words; other_instrument names the instrument when it is 'other'.
 * Experience is a range, not a number of years: people answer a range honestly and a number
 * badly. shared/studentProfile.ts lists the same values for the forms.
 *
 * The student and staff read and write the profile. Family members read it, as they read a
 * student's practice.
 */

create table if not exists app_public.student_profiles (
  user_id uuid primary key references app_public.users(id) on delete cascade,
  background text not null default '' check (length(background) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app_public.student_profiles is
  'What a student told us about themself at onboarding: background is free text about how they came to music and what they want from lessons.';

create table if not exists app_public.student_instruments (
  user_id uuid not null references app_public.users(id) on delete cascade,
  instrument text not null check (instrument in ('drums', 'guitar', 'piano', 'other')),
  experience text not null,
  primary key (user_id, instrument)
);

alter table app_public.student_instruments
  add column if not exists other_instrument text;

alter table app_public.student_instruments
  drop constraint if exists student_instruments_experience_check,
  add constraint student_instruments_experience_check check (experience in (
    'none', 'under_1_year', '1_to_3_years', '3_to_5_years', '5_to_10_years', 'over_10_years'
  )),
  drop constraint if exists student_instruments_other_instrument_check,
  add constraint student_instruments_other_instrument_check check (
    other_instrument is null
    or (instrument = 'other' and length(trim(other_instrument)) between 1 and 100)
  );

comment on table app_public.student_instruments is
  'An instrument a student wants to learn, and how long they have played it. instrument takes the contact form''s values (shared/contactOptions.ts).';

drop trigger if exists _100_timestamps on app_public.student_profiles;
create trigger _100_timestamps before insert or update on app_public.student_profiles
  for each row execute function app_private.tg__timestamps();

alter table app_public.student_profiles enable row level security;
alter table app_public.student_instruments enable row level security;

grant select, delete on app_public.student_profiles to :DATABASE_VISITOR;
grant insert (user_id, background), update (background) on app_public.student_profiles to :DATABASE_VISITOR;
grant select, delete on app_public.student_instruments to :DATABASE_VISITOR;
grant insert (user_id, instrument, experience, other_instrument), update (experience, other_instrument)
  on app_public.student_instruments to :DATABASE_VISITOR;

drop policy if exists select_own on app_public.student_profiles;
create policy select_own on app_public.student_profiles for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or user_id = app_public.current_user_id()
    or user_id in (select app_public.current_user_family_member_ids())
  );

drop policy if exists manage_own on app_public.student_profiles;
create policy manage_own on app_public.student_profiles for all
  using (app_public.current_user_role() in ('admin', 'teacher') or user_id = app_public.current_user_id())
  with check (app_public.current_user_role() in ('admin', 'teacher') or user_id = app_public.current_user_id());

drop policy if exists select_own on app_public.student_instruments;
create policy select_own on app_public.student_instruments for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or user_id = app_public.current_user_id()
    or user_id in (select app_public.current_user_family_member_ids())
  );

drop policy if exists manage_own on app_public.student_instruments;
create policy manage_own on app_public.student_instruments for all
  using (app_public.current_user_role() in ('admin', 'teacher') or user_id = app_public.current_user_id())
  with check (app_public.current_user_role() in ('admin', 'teacher') or user_id = app_public.current_user_id());

--! split: 3-onboarding.sql
/*
 * Onboarding: a new student or parent account sees the onboarding steps once, at first login.
 * users.onboarded_at is null until the person finishes them; staff accounts never see them.
 * Accounts that existed before onboarding was added count as onboarded from when they were
 * made.
 *
 * Reruns safely: the backfill runs only in the run that adds the column.
 */

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'app_public' and table_name = 'users' and column_name = 'onboarded_at'
  ) then
    alter table app_public.users add column onboarded_at timestamptz;
    -- The backfill is not an edit by the person, so it leaves updated_at as it was.
    alter table app_public.users disable trigger _100_timestamps;
    update app_public.users set onboarded_at = created_at;
    alter table app_public.users enable trigger _100_timestamps;
  end if;
end
$$;

comment on column app_public.users.onboarded_at is
  'When the person finished onboarding; null until then. A student or parent with null sees onboarding at login.';

/* Marks the current user's onboarding finished. A second call changes nothing. */
create or replace function app_public.finish_onboarding() returns void as $$
  update app_public.users
     set onboarded_at = now()
   where id = app_public.current_user_id()
     and onboarded_at is null;
$$ language sql volatile security definer set search_path to pg_catalog, public, pg_temp;

revoke all on function app_public.finish_onboarding() from public;
grant execute on function app_public.finish_onboarding() to :DATABASE_VISITOR;

/*
 * Gives the current user a password when the account has none, such as an invited account or
 * a Google sign-up. Returns false when it already has one: changing a password needs the old
 * one (app_public.change_password). It runs in the visitor transaction that finishes
 * onboarding, so a refused username leaves no password behind.
 */
create or replace function app_public.set_initial_password(p_password text)
returns boolean as $$
begin
  update app_private.user_secrets
     set password_hash = crypt(p_password, gen_salt('bf'))
   where user_id = app_public.current_user_id()
     and password_hash is null;
  return found;
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;

revoke all on function app_public.set_initial_password(text) from public;
grant execute on function app_public.set_initial_password(text) to :DATABASE_VISITOR;

/*
 * Adds a child account to the current user's family, with the instruments the parent gave
 * for the child. A parent in no family gets one, named after them, with the parent as owner
 * and billing contact. A parent in several families is refused: staff choose the family.
 * p_instruments is a JSON array of {instrument, experience, other_instrument}.
 */
create or replace function app_public.add_my_child(p_child_name text, p_instruments jsonb default '[]')
returns app_public.users as $$
declare
  v_me app_public.users;
  v_family_ids uuid[];
  v_family_id uuid;
  v_slug citext;
  v_counter int := 0;
  v_child app_public.users;
begin
  select * into v_me from app_public.users where id = app_public.current_user_id();
  if v_me is null then
    raise exception 'You must log in to add a student' using errcode = 'LOGIN';
  end if;

  select array_agg(family_id) into v_family_ids
    from app_public.family_memberships
   where user_id = v_me.id;

  if coalesce(array_length(v_family_ids, 1), 0) > 1 then
    raise exception 'You belong to several families. Ask your teacher which family this student joins.'
      using errcode = 'DNIED';
  elsif coalesce(array_length(v_family_ids, 1), 0) = 1 then
    v_family_id := v_family_ids[1];
  elsif v_me.role = 'parent' then
    v_slug := regexp_replace(lower(v_me.username::text), '[^a-z0-9]+', '-', 'g');
    while exists (
      select 1 from app_public.families
       where slug = case when v_counter = 0 then v_slug else v_slug || '-' || v_counter end
    ) loop
      v_counter := v_counter + 1;
    end loop;
    if v_counter > 0 then
      v_slug := v_slug || '-' || v_counter;
    end if;
    insert into app_public.families (slug, name)
      values (v_slug, coalesce(nullif(trim(v_me.name), ''), v_me.username::text) || ' family')
      returning id into v_family_id;
    insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
      values (v_family_id, v_me.id, true, true);
  else
    raise exception 'You must belong to a family to add a student' using errcode = 'DNIED';
  end if;

  v_child := app_public.create_child(v_family_id, p_child_name);

  insert into app_public.student_instruments (user_id, instrument, experience, other_instrument)
    select v_child.id, item->>'instrument', item->>'experience', nullif(trim(item->>'other_instrument'), '')
      from jsonb_array_elements(p_instruments) as item;

  return v_child;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

revoke all on function app_public.add_my_child(text, jsonb) from public;
grant execute on function app_public.add_my_child(text, jsonb) to :DATABASE_VISITOR;
