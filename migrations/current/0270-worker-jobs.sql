-- App-specific worker jobs and extensions to the auth system.
-- Base auth functions (login, forgot_password, link_or_register_user, etc.)
-- are provided by 0150-user_auth.sql from graphile-starter.

-- Magic link tokens (extension to user_secrets)
alter table app_private.user_secrets
  add column if not exists magic_link_token text,
  add column if not exists magic_link_token_expires_at timestamptz;

-- Magic link generation function
create function app_private.generate_magic_link(v_email citext)
returns void as $$
declare
  v_user app_public.users;
  v_user_email app_public.user_emails;
  v_token text;
begin
  -- Look up user through user_emails
  select u.* into v_user
    from app_public.users u
    join app_public.user_emails ue on ue.user_id = u.id
    where ue.email = v_email and ue.is_verified = true;
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
    json_build_object('id', v_user.id, 'email', v_email::text, 'token', v_token)
  );
end;
$$ language plpgsql strict security definer set search_path to pg_catalog, public, pg_temp;

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
$$ language plpgsql strict security definer set search_path to pg_catalog, public, pg_temp;

-- Comments
comment on function app_private.generate_magic_link(citext) is 'Generates a 15-minute magic link token and queues email send.';
comment on function app_private.verify_magic_link(text) is 'Validates and consumes a magic link token. Returns user or null.';

-- Seed the gcal sync polling job (self-reschedules every 3 minutes)
select graphile_worker.add_job(
  'gcal__sync', '{}'::json,
  job_key := 'gcal__sync',
  max_attempts := 1
);
