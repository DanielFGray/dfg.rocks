create function app_private.login(identifier citext, password text)
returns app_public.users as $$
declare
  v_user app_public.users;
  v_secrets app_private.user_secrets;
begin
  select u.* into v_user
    from app_public.users u
    where u.email = identifier or u.username = identifier;

  if v_user is null then
    -- Constant-time: hash anyway to prevent timing oracle
    perform crypt(password, gen_salt('bf'));
    return null;
  end if;

  select * into v_secrets from app_private.user_secrets where user_id = v_user.id;

  -- Account lockout: 3+ failed attempts within 5 minutes
  if v_secrets.failed_password_attempts >= 3
     and v_secrets.first_failed_password_attempt > now() - interval '5 minutes' then
    raise exception 'Account locked — too many failed attempts. Try again in a few minutes.'
      using errcode = 'LOCKD';
  end if;

  if v_secrets.password_hash is null or
     v_secrets.password_hash <> crypt(password, v_secrets.password_hash) then
    -- Track failed attempt (update MUST commit, so don't raise after)
    update app_private.user_secrets
      set failed_password_attempts = case
            when first_failed_password_attempt is null
              or first_failed_password_attempt <= now() - interval '5 minutes'
            then 1
            else failed_password_attempts + 1
          end,
          first_failed_password_attempt = case
            when first_failed_password_attempt is null
              or first_failed_password_attempt <= now() - interval '5 minutes'
            then now()
            else first_failed_password_attempt
          end
      where user_id = v_user.id;
    return null;
  end if;

  -- Success: reset lockout counter, record login time
  update app_private.user_secrets
    set failed_password_attempts = 0,
        first_failed_password_attempt = null,
        last_login_at = now()
    where user_id = v_user.id;

  return v_user;
end;
$$ language plpgsql strict security definer;

create function app_private.set_password(v_user_id uuid, new_password text)
returns void as $$
begin
  update app_private.user_secrets
    set password_hash = crypt(new_password, gen_salt('bf', 12))
    where user_id = v_user_id;
end;
$$ language plpgsql strict security definer;

create function app_private.create_user(
  v_username citext,
  v_email citext,
  v_name text,
  v_role app_public.user_role,
  v_password text default null
)
returns app_public.users as $$
declare
  v_user app_public.users;
begin
  insert into app_public.users (username, email, name, role)
    values (v_username, v_email, v_name, v_role)
    returning * into v_user;

  insert into app_private.user_secrets (user_id)
    values (v_user.id);

  if v_password is not null then
    perform app_private.set_password(v_user.id, v_password);
  end if;

  return v_user;
end;
$$ language plpgsql security definer;
