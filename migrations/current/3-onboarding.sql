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
