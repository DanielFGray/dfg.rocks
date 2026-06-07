/*
 * The sessions table tracks who is logged in. The primary key is a
 * cryptographically secure random uuid used internally by the app
 * and RLS. Browser cookies carry a separate public lookup identifier
 * plus bearer secret; only the secret hash is stored in Postgres.
 *
 * current_user_id() resolves the user by joining through sessions
 * rather than trusting a direct setting — even if an attacker could
 * set arbitrary transaction settings, they'd need a valid session
 * UUID to impersonate another user.
 */

create table app_private.sessions (
  id uuid not null default gen_random_uuid() primary key,
  cookie_id text not null unique default encode(gen_random_bytes(32), 'hex'),
  secret_hash bytea not null default gen_random_bytes(32),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
alter table app_private.sessions enable row level security;

create index on app_private.sessions (user_id);

comment on column app_private.sessions.cookie_id is
  E'Public session lookup identifier stored in the browser cookie. Separate from the internal session UUID used by RLS.';

comment on column app_private.sessions.secret_hash is
  E'SHA-256 hash of the bearer secret paired with cookie_id. The raw secret is never stored.';

-- Reads the session id set by withAuthContext via set_config('my.session_id', ...).
create function app_public.current_session_id() returns uuid as $$
  select nullif(pg_catalog.current_setting('my.session_id', true), '')::uuid;
$$ language sql stable;
comment on function app_public.current_session_id() is
  E'Returns the current session ID from transaction-local settings.';

-- Secure: derives user_id by joining sessions, not from a direct setting.
create function app_public.current_user_id() returns uuid as $$
  select user_id from app_private.sessions where id = app_public.current_session_id();
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_public.current_user_id() is
  E'Returns the current user ID by looking up the session. Cannot be spoofed without a valid session UUID.';

-- current_user_role() is defined in 0120-users.sql (needs user_role enum + users table).
