-- Generic job trigger (following postgres.garden pattern)
create function app_private.tg__add_job() returns trigger as $$
begin
  perform graphile_worker.add_job(tg_argv[0], json_build_object('id', NEW.id));
  return new;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

-- Magic link tokens
alter table app_private.user_secrets
  add column if not exists magic_link_token text,
  add column if not exists magic_link_token_expires_at timestamptz;

-- OAuth support
create table if not exists app_public.user_authentications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_public.users(id) on delete cascade,
  service text not null,
  identifier text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(service, identifier)
);

grant select, delete on app_public.user_authentications to :DATABASE_VISITOR;
alter table app_public.user_authentications enable row level security;
create policy select_own on app_public.user_authentications for select
  using (user_id::text = current_setting('my.user_id', true));
create policy delete_own on app_public.user_authentications for delete
  using (user_id::text = current_setting('my.user_id', true));

-- Magic link generation function
create function app_private.generate_magic_link(v_email citext)
returns void as $$
declare
  v_user app_public.users;
  v_token text;
begin
  select * into v_user from app_public.users where email = v_email;
  if v_user is null then
    return; -- silently ignore unknown emails
  end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  update app_private.user_secrets
    set magic_link_token = v_token,
        magic_link_token_expires_at = now() + interval '15 minutes'
    where user_id = v_user.id;
  perform graphile_worker.add_job(
    'user__magic_link',
    json_build_object('id', v_user.id, 'email', v_user.email::text, 'token', v_token)
  );
end;
$$ language plpgsql strict security definer;

-- Verify magic link token
create function app_private.verify_magic_link(v_token text)
returns app_public.users as $$
declare
  v_secrets app_private.user_secrets;
  v_user app_public.users;
begin
  select * into v_secrets from app_private.user_secrets
    where magic_link_token = v_token
      and magic_link_token_expires_at > now();
  if v_secrets is null then
    return null;
  end if;
  -- Clear the token
  update app_private.user_secrets
    set magic_link_token = null, magic_link_token_expires_at = null
    where user_id = v_secrets.user_id;
  select * into v_user from app_public.users where id = v_secrets.user_id;
  return v_user;
end;
$$ language plpgsql strict security definer;

-- OAuth link-or-register function
create function app_private.link_or_register_user(
  v_service text,
  v_identifier text,
  v_profile jsonb,
  v_auth_details jsonb
)
returns app_public.users as $$
declare
  v_matched_authentication app_public.user_authentications;
  v_user app_public.users;
  v_email citext;
  v_name text;
begin
  -- Check if this OAuth identity already linked
  select * into v_matched_authentication
    from app_public.user_authentications
    where service = v_service and identifier = v_identifier;

  if v_matched_authentication is not null then
    -- Update details and return existing user
    update app_public.user_authentications
      set details = v_auth_details
      where id = v_matched_authentication.id;
    select * into v_user from app_public.users where id = v_matched_authentication.user_id;
    return v_user;
  end if;

  -- Extract email from profile
  v_email := v_profile->>'email';
  v_name := coalesce(v_profile->>'name', v_profile->>'email');

  -- Try to find existing user by email
  if v_email is not null then
    select * into v_user from app_public.users where email = v_email;
  end if;

  -- Create new user if not found
  if v_user is null then
    if v_email is null then
      raise exception 'OAuth profile must include email';
    end if;
    v_user := app_private.create_user(
      v_email, -- username = email
      v_email,
      v_name,
      'student'::app_public.user_role
    );
  end if;

  -- Link the OAuth identity
  insert into app_public.user_authentications (user_id, service, identifier, details)
    values (v_user.id, v_service, v_identifier, v_auth_details);

  return v_user;
end;
$$ language plpgsql volatile security definer;

-- Update forgot_password to use worker
create or replace function app_private.generate_reset_token(v_email citext)
returns void as $$
declare
  v_user app_public.users;
  v_token text;
begin
  select * into v_user from app_public.users where email = v_email;
  if v_user is null then return; end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  update app_private.user_secrets
    set reset_password_token = v_token,
        reset_password_token_expires_at = now() + interval '1 hour'
    where user_id = v_user.id;
  perform graphile_worker.add_job(
    'user__forgot_password',
    json_build_object('id', v_user.id, 'email', v_user.email::text, 'token', v_token)
  );
end;
$$ language plpgsql strict security definer;

-- Update invite to use worker
create or replace function app_private.generate_invite_token(v_user_id uuid)
returns void as $$
declare
  v_user app_public.users;
  v_token text;
begin
  select * into v_user from app_public.users where id = v_user_id;
  if v_user is null then return; end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  update app_private.user_secrets
    set invite_token = v_token,
        invite_token_expires_at = now() + interval '7 days'
    where user_id = v_user_id;
  perform graphile_worker.add_job(
    'user__invite',
    json_build_object('id', v_user_id, 'email', v_user.email::text, 'token', v_token)
  );
end;
$$ language plpgsql strict security definer;
