/*
 * Limit what any signed-in account can reach.
 *
 * Anyone can sign in with Google or Apple and get an account with no family,
 * no rate and no enrollment. Such an account must not see other people, message
 * them, book lessons, or create families.
 */

-- Users ---------------------------------------------------------------------

-- Staff rows stay visible to everyone: a non-staff user messages staff, and the
-- message service finds the default recipient by reading users under RLS.
drop policy if exists select_all on app_public.users;
drop policy if exists select_visible on app_public.users;
create policy select_visible on app_public.users for select
  using (
    id = app_public.current_user_id()
    or role in ('admin', 'teacher')
    or id in (select app_public.current_user_family_member_ids())
    or app_public.current_user_role() in ('admin', 'teacher')
  );

-- Messages ------------------------------------------------------------------

-- A non-staff user, or a parent acting for a family student, may message only
-- staff. Staff send through insert_admin.
drop policy if exists insert_sender on app_public.messages;
create policy insert_sender on app_public.messages for insert
  with check (
    app_public.is_acting_for_family_student(sender_id)
    and exists (
      select 1 from app_public.users
       where users.id = recipient_id
         and users.role in ('admin', 'teacher')
    )
  );

-- Lessons -------------------------------------------------------------------

-- A student or parent may book only at a location the teacher has priced for
-- that student.
drop policy if exists insert_family on app_public.lessons;
create policy insert_family on app_public.lessons for insert
  with check (
    app_public.can_book_for_family_student(student_id)
    and exists (
      select 1 from app_public.student_rates
       where student_rates.student_id = lessons.student_id
         and student_rates.location_type = lessons.location_type
    )
  );

-- Families ------------------------------------------------------------------

-- Family membership is what lets a user call create_child and invite_to_family,
-- so only staff may create a family.
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
    values(v_org.id, app_public.current_user_id(), true, true);
  return v_org;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

-- OAuth ---------------------------------------------------------------------

/*
 * An OAuth email counts as verified only when the provider says so in the
 * profile's email_verified field. Only a verified email links the login to an
 * existing account; otherwise anyone with a provider account holding that
 * address unverified could sign in as its owner.
 */
create or replace function app_private.link_or_register_user(
  f_user_id uuid,
  f_service character varying,
  f_identifier character varying,
  f_profile json,
  f_auth_details json
) returns app_public.users as $$
declare
  v_matched_user_id uuid;
  v_matched_authentication_id uuid;
  v_email citext;
  v_email_verified boolean;
  v_name text;
  v_avatar_url text;
  v_user app_public.users;
  v_user_email app_public.user_emails;
begin
  -- See if a user account already matches these details
  select id, user_id
    into v_matched_authentication_id, v_matched_user_id
    from app_public.user_authentications
    where service = f_service
    and identifier = f_identifier
    limit 1;

  if v_matched_user_id is not null and f_user_id is not null and v_matched_user_id <> f_user_id then
    raise exception 'A different user already has this account linked.' using errcode = 'TAKEN';
  end if;

  v_email = f_profile ->> 'email';
  -- Google sends a JSON boolean, Apple may send the string "true"; both read as 'true'.
  v_email_verified := coalesce((f_profile ->> 'email_verified') = 'true', false);
  v_name := f_profile ->> 'name';
  v_avatar_url := f_profile ->> 'avatar_url';

  if v_matched_authentication_id is null then
    if f_user_id is not null then
      -- Link new account to logged in user account
      insert into app_public.user_authentications (user_id, service, identifier, details) values
        (f_user_id, f_service, f_identifier, f_profile) returning id, user_id into v_matched_authentication_id, v_matched_user_id;
      insert into app_private.user_authentication_secrets (user_authentication_id, details) values
        (v_matched_authentication_id, f_auth_details);
      perform graphile_worker.add_job(
        'user__audit',
        json_build_object(
          'type', 'linked_account',
          'user_id', f_user_id,
          'extra1', f_service,
          'extra2', f_identifier,
          'current_user_id', app_public.current_user_id()
        ));
    elsif v_email is not null and v_email_verified then
      -- See if the email is registered
      select * into v_user_email from app_public.user_emails where email = v_email and is_verified is true;
      if v_user_email is not null then
        -- User exists!
        insert into app_public.user_authentications (user_id, service, identifier, details) values
          (v_user_email.user_id, f_service, f_identifier, f_profile) returning id, user_id into v_matched_authentication_id, v_matched_user_id;
        insert into app_private.user_authentication_secrets (user_authentication_id, details) values
          (v_matched_authentication_id, f_auth_details);
        perform graphile_worker.add_job(
          'user__audit',
          json_build_object(
            'type', 'linked_account',
            'user_id', f_user_id,
            'extra1', f_service,
            'extra2', f_identifier,
            'current_user_id', app_public.current_user_id()
          ));
      end if;
    end if;
  end if;

  if v_matched_user_id is null and f_user_id is null and v_matched_authentication_id is null then
    -- Create and return a new user account
    return app_private.register_user(f_service, f_identifier, f_profile, f_auth_details, v_email_verified);
  end if;

  if v_matched_authentication_id is null then
    -- v_matched_authentication_id is null
    -- -> v_matched_user_id is null (they're paired)
    -- -> f_user_id is not null (because the if clause above)
    -- -> v_matched_authentication_id is not null (because of the separate if block above creating a user_authentications)
    -- -> contradiction.
    raise exception 'This should not occur';
  end if;

  update app_public.user_authentications
    set details = f_profile
    where id = v_matched_authentication_id;
  update app_private.user_authentication_secrets
    set details = f_auth_details
    where user_authentication_id = v_matched_authentication_id;
  update app_public.users
    set
      name = coalesce(users.name, v_name),
      avatar_url = coalesce(users.avatar_url, v_avatar_url)
    where id = v_matched_user_id
    returning  * into v_user;
  return v_user;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;
