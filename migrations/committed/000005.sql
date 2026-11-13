--! Previous: sha1:143c082e3d94a7fbc476c3d724843c1f3ee2e17b
--! Hash: sha1:7c36b829228ec23b21df37ecd1a77e373ef87eed

--! split: 1-current.sql
-- The row change authorizes and commits the calendar job. The visitor has no
-- general access to graphile-worker, and Google runs only after this commits.
create or replace function app_private.tg_lessons__sync_calendar_event() returns trigger as $$
declare
  v_lesson_id uuid;
  v_event_id text;
begin
  if tg_op = 'UPDATE' then
    if row(old.student_id, old.scheduled_at, old.duration_minutes, old.location_type, old.status)
       is not distinct from
       row(new.student_id, new.scheduled_at, new.duration_minutes, new.location_type, new.status) then
      return null;
    end if;
  end if;
  if tg_op = 'INSERT' then
    v_lesson_id := new.id;
    v_event_id := new.gcal_event_id;
  else
    v_lesson_id := old.id;
    v_event_id := old.gcal_event_id;
  end if;
  perform graphile_worker.add_job(
    'lessons__sync_calendar_event',
    json_build_object('lessonId', v_lesson_id, 'gcalEventId', v_event_id),
    queue_name := 'gcal',
    job_key := 'lessons__sync_calendar_event:' || v_lesson_id::text,
    job_key_mode := 'replace'
  );
  return null;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

drop trigger if exists _500_sync_calendar_event on app_public.lessons;
create trigger _500_sync_calendar_event
  after insert or update or delete on app_public.lessons
  for each row execute function app_private.tg_lessons__sync_calendar_event();

--! split: 2-link-or-register-user.sql
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
    elsif v_email is not null
      and coalesce((f_profile ->> 'email_verified')::boolean, false) is true then
      -- Link by email only when the provider marks the address verified; an
      -- unverified provider address must not sign in as an existing user.
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
            'user_id', v_user_email.user_id,
            'extra1', f_service,
            'extra2', f_identifier,
            'current_user_id', app_public.current_user_id()
          ));
      end if;
    end if;
  end if;

  if v_matched_user_id is null and f_user_id is null and v_matched_authentication_id is null then
    -- Create and return a new user account
    return app_private.register_user(
      f_service,
      f_identifier,
      f_profile,
      f_auth_details,
      coalesce((f_profile ->> 'email_verified')::boolean, false)
    );
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
