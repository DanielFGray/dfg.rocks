drop function if exists app_public.create_child(uuid, text);

create function app_public.create_child(
  p_family_id uuid,
  p_child_name text
) returns app_public.users as $$
declare
  v_base citext;
  v_username citext;
  v_counter int := 0;
  v_user app_public.users;
begin
  if app_public.current_user_id() is null then
    raise exception 'You must log in to create a child' using errcode = 'LOGIN';
  end if;

  if not exists (
    select 1 from app_public.family_memberships
    where family_memberships.family_id = create_child.p_family_id
    and family_memberships.user_id = app_public.current_user_id()
  ) then
    raise exception 'You must be a member of this family' using errcode = 'DNIED';
  end if;

  v_base := lower(regexp_replace(trim(p_child_name), '\s+', '_', 'g'));
  v_base := regexp_replace(v_base, '[^a-z0-9_]', '', 'g');
  if v_base = '' then
    v_base := 'student';
  end if;

  v_username := v_base;
  loop
    if not exists (select 1 from app_public.users where username = v_username) then
      exit;
    end if;
    v_counter := v_counter + 1;
    v_username := v_base || v_counter::text;
  end loop;

  v_user := app_private.really_create_user(
    username => v_username,
    name => p_child_name,
    avatar_url => null,
    email_is_verified => false,
    email => null,
    password => null
  );

  insert into app_public.family_memberships (family_id, user_id)
    values (create_child.p_family_id, v_user.id);

  return v_user;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

create function app_private.set_child_email(
  parent_id uuid,
  child_id uuid,
  new_email citext
) returns uuid as $$
declare
  v_email_id uuid;
begin
  if not exists (
    select 1 from app_public.family_memberships fm_parent
    inner join app_public.family_memberships fm_child
      on fm_child.family_id = fm_parent.family_id
    where fm_parent.user_id = parent_id
      and fm_child.user_id = child_id
      and fm_child.user_id <> parent_id
  ) then
    raise exception 'Child is not in your family' using errcode = 'DNIED';
  end if;

  if exists (
    select 1 from app_public.user_emails
    where email = new_email and is_verified = true
  ) then
    raise exception 'This email address is already in use' using errcode = 'MODAT';
  end if;

  insert into app_public.user_emails (user_id, email, is_verified, is_primary)
  values (child_id, new_email, false, true)
  returning id into v_email_id;

  return v_email_id;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

create function app_private.request_child_password_set(
  parent_id uuid,
  child_id uuid
) returns text as $$
declare
  v_token text;
begin
  if not exists (
    select 1 from app_public.family_memberships fm_parent
    inner join app_public.family_memberships fm_child
      on fm_child.family_id = fm_parent.family_id
    where fm_parent.user_id = parent_id
      and fm_child.user_id = child_id
      and fm_child.user_id <> parent_id
  ) then
    raise exception 'Child is not in your family' using errcode = 'DNIED';
  end if;

  v_token := encode(gen_random_bytes(20), 'hex');

  update app_private.user_secrets
  set
    child_password_reset_token = v_token,
    child_password_reset_token_generated = now()
  where user_id = child_id;

  return v_token;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

create function app_private.set_child_password(
  child_id uuid,
  token text,
  new_password text
) returns void as $$
declare
  v_token_max_duration interval := interval '24 hours';
  v_user_secret app_private.user_secrets;
begin
  select * into v_user_secret
  from app_private.user_secrets
  where user_secrets.user_id = child_id;

  if v_user_secret.child_password_reset_token is null
     or v_user_secret.child_password_reset_token_generated is null
     or v_user_secret.child_password_reset_token_generated < now() - v_token_max_duration
  then
    raise exception 'The reset token has expired. Please request a new one.' using errcode = 'MODAT';
  end if;

  if v_user_secret.child_password_reset_token <> token then
    raise exception 'Invalid reset token' using errcode = 'MODAT';
  end if;

  update app_private.user_secrets
  set
    password_hash = crypt(new_password, gen_salt('bf')),
    child_password_reset_token = null,
    child_password_reset_token_generated = null
  where user_id = child_id;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;
