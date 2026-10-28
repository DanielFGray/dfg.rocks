--! Previous: -
--! Hash: sha1:ef6571e4102a5c0cb4d3a2739f8c8b735e408434
--! Message: initial schema

--! split: 0001-reset.sql
/*
 * Graphile Migrate will run our `current/...` migrations in one batch. Since
 * this is our first migration it's defining the entire database, so we first
 * drop anything that may have previously been created
 * (app_public/app_hidden/app_private) so that we can start from scratch.
 */

drop schema if exists app_public cascade;
drop schema if exists app_hidden cascade;
drop schema if exists app_private cascade;

--! split: 0010-public-permissions.sql
/*
 * The `public` *schema* contains things like PostgreSQL extensions. We
 * deliberately do not install application logic into the public schema
 * (instead storing it to app_public/app_hidden/app_private as appropriate),
 * but none the less we don't want untrusted roles to be able to install or
 * modify things into the public schema.
 *
 * The `public` *role* is automatically inherited by all other roles; we only
 * want specific roles to be able to access our database so we must revoke
 * access to the `public` role.
 */

revoke all on schema public from public;

alter default privileges revoke all on sequences from public;
alter default privileges revoke all on functions from public;

-- Of course we want our database owner to be able to do anything inside the
-- database, so we grant access to the `public` schema:
grant all on schema public to :DATABASE_OWNER;

--! split: 0020-schemas.sql
/*
 * Read about our app_public/app_hidden/app_private schemas here:
 * https://www.graphile.org/postgraphile/namespaces/#advice
 *
 * Note this pattern is not required to use PostGraphile, it's merely the
 * preference of the author of this package.
 */

create schema app_public;
create schema app_hidden;
create schema app_private;

-- The 'visitor' role (used by PostGraphile to represent an end user) may
-- access the public, app_public and app_hidden schemas (but _NOT_ the
-- app_private schema).
grant usage on schema public, app_public, app_hidden to :DATABASE_VISITOR;

-- We want the `visitor` role to be able to insert rows (`serial` data type
-- creates sequences, so we need to grant access to that).
alter default privileges in schema public, app_public, app_hidden
  grant usage, select on sequences to :DATABASE_VISITOR;

-- And the `visitor` role should be able to call functions too.
alter default privileges in schema public, app_public, app_hidden
  grant execute on functions to :DATABASE_VISITOR;

--! split: 0030-common-triggers.sql
/*
 * These triggers are commonly used across many tables.
 */

-- Used for queueing jobs easily; relies on the fact that every table we have
-- has a primary key 'id' column; this won't work if you rename your primary
-- key columns.
create function app_private.tg__add_job() returns trigger as $$
begin
  perform graphile_worker.add_job(tg_argv[0], json_build_object('id', NEW.id));
  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_private.tg__add_job() is
  E'Useful shortcut to create a job on insert/update. Pass the task name as the first trigger argument, and optionally the queue name as the second argument. The record id will automatically be available on the JSON payload.';

-- This trigger is used to queue a job to inform a user that a significant
-- security change has been made to their account (e.g. adding a new email
-- address, linking a new social login).
create function app_private.tg__add_audit_job() returns trigger as $$
declare
  v_user_id uuid;
  v_type text = TG_ARGV[0];
  v_user_id_attribute text = TG_ARGV[1];
  v_extra_attribute1 text = TG_ARGV[2];
  v_extra_attribute2 text = TG_ARGV[3];
  v_extra_attribute3 text = TG_ARGV[4];
  v_extra1 text;
  v_extra2 text;
  v_extra3 text;
begin
  if v_user_id_attribute is null then
    raise exception 'Invalid tg__add_audit_job call';
  end if;

  execute 'select ($1.' || quote_ident(v_user_id_attribute) || ')::uuid'
    using (case when TG_OP = 'INSERT' then NEW else OLD end)
    into v_user_id;

  if v_extra_attribute1 is not null then
    execute 'select ($1.' || quote_ident(v_extra_attribute1) || ')::text'
      using (case when TG_OP = 'DELETE' then OLD else NEW end)
      into v_extra1;
  end if;
  if v_extra_attribute2 is not null then
    execute 'select ($1.' || quote_ident(v_extra_attribute2) || ')::text'
      using (case when TG_OP = 'DELETE' then OLD else NEW end)
      into v_extra2;
  end if;
  if v_extra_attribute3 is not null then
    execute 'select ($1.' || quote_ident(v_extra_attribute3) || ')::text'
      using (case when TG_OP = 'DELETE' then OLD else NEW end)
      into v_extra3;
  end if;

  if v_user_id is not null then
    perform graphile_worker.add_job(
      'user__audit',
      json_build_object(
        'type', v_type,
        'user_id', v_user_id,
        'extra1', v_extra1,
        'extra2', v_extra2,
        'extra3', v_extra3,
        'current_user_id', app_public.current_user_id(),
        'schema', TG_TABLE_SCHEMA,
        'table', TG_TABLE_NAME
      ));
  end if;

  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_private.tg__add_audit_job() is
  E'For notifying a user that an auditable action has taken place. Call with audit event name, user ID attribute name, and optionally another value to be included (e.g. the PK of the table, or some other relevant information). e.g. `tg__add_audit_job(''added_email'', ''user_id'', ''email'')`';

/*
 * This trigger is used on tables with created_at and updated_at to ensure that
 * these timestamps are kept valid (namely: `created_at` cannot be changed, and
 * `updated_at` must be monotonically increasing).
 */
create function app_private.tg__timestamps() returns trigger as $$
begin
  NEW.created_at = (case when TG_OP = 'INSERT' then NOW() else OLD.created_at end);
  NEW.updated_at = (case when TG_OP = 'UPDATE' and OLD.updated_at >= NOW() then OLD.updated_at + interval '1 millisecond' else NOW() end);
  return NEW;
end;
$$ language plpgsql volatile set search_path to pg_catalog, public, pg_temp;
comment on function app_private.tg__timestamps() is
  E'This trigger should be called on all tables with created_at, updated_at - it ensures that they cannot be manipulated and that updated_at will always be larger than the previous updated_at.';

/*
 * This trigger is useful for adding realtime features to our GraphQL schema
 * with minimal effort in the database. It's a very generic trigger function;
 * you're intended to pass three arguments when you call it:
 *
 * 1. The "event" name to include, this is an arbitrary string.
 * 2. The "topic" template that we'll be publishing the event to. A `$1` in
 *    this may be added as a placeholder which will be replaced by the
 *    "subject" value.
 * 3. The "subject" column, we'll read the value of this column from the NEW
 *    (for insert/update) or OLD (for delete) record and include it in the
 *    event payload.
 *
 * A PostgreSQL `NOTIFY` will be issued to the topic (or "channel") generated
 * from arguments 2 and 3, the body of the notification will be a stringified
 * JSON object containing `event`, `sub` (the subject specified by argument 3)
 * and `id` (the record id).
 *
 * Example:
 *
 *     create trigger _500_gql_update
 *       after update on app_public.users
 *       for each row
 *       execute procedure app_public.tg__graphql_subscription(
 *         'userChanged', -- the "event" string, useful for the client to know what happened
 *         'graphql:user:$1', -- the "topic" the event will be published to, as a template
 *         'id' -- If specified, `$1` above will be replaced with NEW.id or OLD.id from the trigger.
 *       );
 */
create function app_public.tg__graphql_subscription() returns trigger as $$
declare
  v_process_new bool = (TG_OP = 'INSERT' OR TG_OP = 'UPDATE');
  v_process_old bool = (TG_OP = 'UPDATE' OR TG_OP = 'DELETE');
  v_event text = TG_ARGV[0];
  v_topic_template text = TG_ARGV[1];
  v_attribute text = TG_ARGV[2];
  v_record record;
  v_sub text;
  v_topic text;
  v_i int = 0;
  v_last_topic text;
begin
  for v_i in 0..1 loop
    if (v_i = 0) and v_process_new is true then
      v_record = new;
    elsif (v_i = 1) and v_process_old is true then
      v_record = old;
    else
      continue;
    end if;
     if v_attribute is not null then
      execute 'select $1.' || quote_ident(v_attribute)
        using v_record
        into v_sub;
    end if;
    if v_sub is not null then
      v_topic = replace(v_topic_template, '$1', v_sub);
    else
      v_topic = v_topic_template;
    end if;
    if v_topic is distinct from v_last_topic then
      -- This if statement prevents us from triggering the same notification twice
      v_last_topic = v_topic;
      perform pg_notify(v_topic, json_build_object(
        'event', v_event,
        'subject', v_sub
      )::text);
    end if;
  end loop;
  return v_record;
end;
$$ language plpgsql volatile;
comment on function app_public.tg__graphql_subscription() is
  E'This function enables the creation of simple focussed GraphQL subscriptions using database triggers. Read more here: https://www.graphile.org/postgraphile/subscriptions/#custom-subscriptions';

--! split: 0100-sessions.sql
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

--! split: 0120-users.sql
/*
 * The users table stores (unsurprisingly) the users of our application. You'll
 * notice that it does NOT contain private information such as the user's
 * password or their email address; that's because the users table is seen as
 * public - anyone who can "see" the user can see this information.
 *
 * The author sees `role` and `is_verified` as public information; if you
 * disagree then you should relocate these attributes to another table, such as
 * `user_secrets`.
 */
create type app_public.user_role as enum('admin', 'teacher', 'parent', 'student');
create domain app_public.username as citext check(length(value) >= 2 and length(value) <= 64 and value ~ '^[a-zA-Z][a-zA-Z0-9_-]+$');
create domain app_public.url as text check(value ~ '^https?://\S+');

create table app_public.users (
  id uuid primary key default gen_random_uuid(),
  username app_public.username not null unique,
  name text,
  avatar_url app_public.url,
  bio text check(length(bio) <= 4000),
  role app_public.user_role not null default 'student',
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table app_public.users enable row level security;
create index idx_users_username on app_public.users (username);
-- create index idx_users_username_trgm on app_public.users using gin(username gin_trgm_ops);

-- We couldn't implement this relationship on the sessions table until the users table existed!
alter table app_private.sessions
  add constraint sessions_user_id_fkey
  foreign key ("user_id") references app_public.users on delete cascade;

-- Derives role by joining through sessions → users. Same security as current_user_id().
-- Defined before policies so they can reference it.
create function app_public.current_user_role() returns app_public.user_role as $$
  select role from app_public.users where id = app_public.current_user_id();
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_public.current_user_role() is
  E'Returns the current user role. Derived via session join, not a direct setting.';

-- Users are publicly visible, like on GitHub, Twitter, Facebook, Trello, etc.
create policy select_all on app_public.users for select using (true);
-- You can only update yourself.
create policy update_self on app_public.users for update using (id = app_public.current_user_id());
-- Admin/teacher can update any user (role changes, etc.)
create policy update_admin on app_public.users for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
grant select on app_public.users to :DATABASE_VISITOR;
-- NOTE: `insert` is not granted, because we'll handle that separately
grant update(username, name, bio, avatar_url) on app_public.users to :DATABASE_VISITOR;
-- NOTE: `delete` is not granted, because we require confirmation via request_account_deletion/confirm_account_deletion

comment on table app_public.users is
  E'A user who can log in to the application.';

comment on column app_public.users.id is
  E'Unique identifier for the user.';
comment on column app_public.users.username is
  E'Public-facing username (or ''handle'') of the user.';
comment on column app_public.users.name is
  E'Public-facing name (or pseudonym) of the user.';
comment on column app_public.users.avatar_url is
  E'Optional avatar URL.';

create trigger _100_timestamps
  before insert or update on app_public.users
  for each row
  execute procedure app_private.tg__timestamps();

/**********/

-- Returns the current user; this is a "custom query" function; see:
-- https://www.graphile.org/postgraphile/custom-queries/
-- So this will be queryable via GraphQL as `{ currentUser { ... } }`
create function app_public.current_user() returns app_public.users as $$
  select users.* from app_public.users where id = app_public.current_user_id();
$$ language sql stable;
comment on function app_public.current_user() is
  E'The currently logged in user (or null if not logged in).';

/**********/

-- The users table contains all the public information, but we need somewhere
-- to store private information. In fact, this data is so private that we don't
-- want the user themselves to be able to see it - things like the bcrypted
-- password hash, timestamps of recent login attempts (to allow us to
-- auto-protect user accounts that are under attack), etc.
create table app_private.user_secrets (
  user_id uuid not null primary key references app_public.users on delete cascade,
  password_hash text,
  last_login_at timestamptz not null default now(),
  failed_password_attempts int not null default 0,
  first_failed_password_attempt timestamptz,
  reset_password_token text,
  reset_password_token_generated timestamptz,
  failed_reset_password_attempts int not null default 0,
  first_failed_reset_password_attempt timestamptz,
  delete_account_token text,
  delete_account_token_generated timestamptz,
  child_password_reset_token text,
  child_password_reset_token_generated timestamptz
);
alter table app_private.user_secrets enable row level security;
comment on table app_private.user_secrets is
  E'The contents of this table should never be visible to the user. Contains data mostly related to authentication.';

/*
 * When we insert into `users` we _always_ want there to be a matching
 * `user_secrets` entry, so we have a trigger to enforce this:
 */
create function app_private.tg_user_secrets__insert_with_user() returns trigger as $$
begin
  insert into app_private.user_secrets(user_id) values(NEW.id);
  return NEW;
end;
$$ language plpgsql volatile set search_path to pg_catalog, public, pg_temp;
create trigger _500_insert_secrets
  after insert on app_public.users
  for each row
  execute procedure app_private.tg_user_secrets__insert_with_user();
comment on function app_private.tg_user_secrets__insert_with_user() is
  E'Ensures that every user record has an associated user_secret record.';

/*
 * Because you can register with username/password or using OAuth (social
 * login), we need a way to tell the user whether or not they have a
 * password. This is to help the UI display the right interface: change
 * password or set password.
 */
create function app_public.users_has_password(u app_public.users) returns boolean as $$
  select (password_hash is not null) from app_private.user_secrets where user_secrets.user_id = u.id and u.id = app_public.current_user_id();
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

/*
 * When the user validates their email address we want the UI to be notified
 * immediately, so we'll issue a notification to the `graphql:user:*` topic
 * which GraphQL users can subscribe to via the `currentUserUpdated`
 * subscription field.
 */
create trigger _500_gql_update
  after update on app_public.users
  for each row
  execute procedure app_public.tg__graphql_subscription(
    'userChanged', -- the "event" string, useful for the client to know what happened
    'graphql:user:$1', -- the "topic" the event will be published to, as a template
    'id' -- If specified, `$1` above will be replaced with NEW.id or OLD.id from the trigger.
  );

--! split: 0130-user_emails.sql
/*
 * A user may have more than one email address; this is useful when letting the
 * user change their email so that they can verify the new one before deleting
 * the old one, but is also generally useful as they might want to use
 * different emails to log in versus where to send notifications. Therefore we
 * track user emails in a separate table.
 */
create table app_public.user_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default app_public.current_user_id() references app_public.users on delete cascade,
  email citext not null check (email ~ '[^@]+@[^@]+\.[^@]+'),
  is_verified boolean not null default false,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Each user can only have an email once.
  constraint user_emails_user_id_email_key unique(user_id, email),
  -- An unverified email cannot be set as the primary email.
  constraint user_emails_must_be_verified_to_be_primary check(is_primary is false or is_verified is true)
);
alter table app_public.user_emails enable row level security;

-- Once an email is verified, it may only be used by one user. (We can't
-- enforce this before an email is verified otherwise it could be used to
-- prevent a legitimate user from signing up.)
create unique index uniq_user_emails_verified_email on app_public.user_emails(email) where (is_verified is true);
-- Only one primary email per user.
create unique index uniq_user_emails_primary_email on app_public.user_emails (user_id) where (is_primary is true);
-- Allow efficient retrieval of all the emails owned by a particular user.
create index idx_user_emails_user on app_public.user_emails (user_id);
-- For the user settings page sorting
create index idx_user_emails_primary on app_public.user_emails (is_primary, user_id);

-- Keep created_at and updated_at up to date.
create trigger _100_timestamps
  before insert or update on app_public.user_emails
  for each row
  execute procedure app_private.tg__timestamps();

-- When an email address is added to a user, notify them (in case their account was compromised).
create trigger _500_audit_added
  after insert on app_public.user_emails
  for each row
  execute procedure app_private.tg__add_audit_job(
    'added_email',
    'user_id',
    'id',
    'email'
  );

-- When an email address is removed from a user, notify them (in case their account was compromised).
create trigger _500_audit_removed
  after delete on app_public.user_emails
  for each row
  execute procedure app_private.tg__add_audit_job(
    'removed_email',
    'user_id',
    'id',
    'email'
  );

-- You can't verify an email address that someone else has already verified. (Email is taken.)
create function app_public.tg_user_emails__forbid_if_verified() returns trigger as $$
begin
  if exists(select 1 from app_public.user_emails where email = NEW.email and is_verified is true) then
    raise exception 'An account using that email address has already been created.' using errcode='EMTKN';
  end if;
  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;
create trigger _200_forbid_existing_email before insert on app_public.user_emails for each row execute procedure app_public.tg_user_emails__forbid_if_verified();

-- If the email wasn't already verified (e.g. via a social login provider) then
-- queue up the verification email to be sent.
create trigger _900_send_verification_email
  after insert on app_public.user_emails
  for each row
  when (NEW.is_verified is false)
  execute procedure app_private.tg__add_job('user_emails__send_verification');

comment on table app_public.user_emails is
  E'Information about a user''s email address.';
comment on column app_public.user_emails.email is
  E'The users email address, in `a@b.c` format.';
comment on column app_public.user_emails.is_verified is
  E'True if the user has is_verified their email address (by clicking the link in the email we sent them, or logging in with a social login provider), false otherwise.';

-- Users may only manage their own emails.
create policy select_own on app_public.user_emails for select using (user_id = app_public.current_user_id());
create policy insert_own on app_public.user_emails for insert with check (user_id = app_public.current_user_id());
-- NOTE: we don't allow emails to be updated, instead add a new email and delete the old one.
create policy delete_own on app_public.user_emails for delete using (user_id = app_public.current_user_id());

-- Admin/teacher can manage any user's emails
create policy select_admin on app_public.user_emails for select
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy insert_admin on app_public.user_emails for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.user_emails for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select on app_public.user_emails to :DATABASE_VISITOR;
grant insert (email) on app_public.user_emails to :DATABASE_VISITOR;
-- No update
grant delete on app_public.user_emails to :DATABASE_VISITOR;

-- Prevent deleting the user's last email, otherwise they can't access password reset/etc.
create function app_public.tg_user_emails__prevent_delete_last_email() returns trigger as $$
begin
  if exists (
    with remaining as (
      select user_emails.user_id
      from app_public.user_emails
      inner join deleted
      on user_emails.user_id = deleted.user_id
      -- Don't delete last verified email
      where (user_emails.is_verified is true or not exists (
        select 1
        from deleted d2
        where d2.user_id = user_emails.user_id
        and d2.is_verified is true
      ))
      order by user_emails.id asc

      /*
       * Lock this table to prevent race conditions; see:
       * https://www.cybertec-postgresql.com/en/triggers-to-enforce-constraints/
       */
      for update of user_emails
    )
    select 1
    from app_public.users
    where id in (
      select user_id from deleted
      except
      select user_id from remaining
    )
  )
  then
    raise exception 'You must have at least one (verified) email address' using errcode = 'CDLEA';
  end if;

  return null;
end;
$$
language plpgsql
-- Security definer is required for 'FOR UPDATE OF' since we don't grant UPDATE privileges.
security definer
set search_path = pg_catalog, public, pg_temp;

-- Note this check runs AFTER the email was deleted. If the user was deleted
-- then their emails will also be deleted (thanks to the foreign key on delete
-- cascade) and this is desirable; we only want to prevent the deletion if
-- the user still exists so we check after the statement completes.
create trigger _500_prevent_delete_last
  after delete on app_public.user_emails
  referencing old table as deleted
  for each statement
  execute procedure app_public.tg_user_emails__prevent_delete_last_email();

/**********/

/*
 * Just like with users and user_secrets, there are secrets for emails that we
 * don't want the user to be able to see - for example the verification token.
 * Like with user_secrets we automatically create a record in this table
 * whenever a record is added to user_emails.
 */
create table app_private.user_email_secrets (
  user_email_id uuid primary key references app_public.user_emails on delete cascade,
  verification_token text,
  verification_email_sent_at timestamptz,
  password_reset_email_sent_at timestamptz
);
alter table app_private.user_email_secrets enable row level security;

comment on table app_private.user_email_secrets is
  E'The contents of this table should never be visible to the user. Contains data mostly related to email verification and avoiding spamming users.';
comment on column app_private.user_email_secrets.password_reset_email_sent_at is
  E'We store the time the last password reset was sent to this email to prevent the email getting flooded.';

create function app_private.tg_user_email_secrets__insert_with_user_email() returns trigger as $$
declare
  v_verification_token text;
begin
  if NEW.is_verified is false then
    v_verification_token = encode(gen_random_bytes(7), 'hex');
  end if;
  insert into app_private.user_email_secrets(user_email_id, verification_token) values(NEW.id, v_verification_token);
  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;
create trigger _500_insert_secrets
  after insert on app_public.user_emails
  for each row
  execute procedure app_private.tg_user_email_secrets__insert_with_user_email();
comment on function app_private.tg_user_email_secrets__insert_with_user_email() is
  E'Ensures that every user_email record has an associated user_email_secret record.';

/**********/

/*
 * When the user receives the email verification message it will contain the
 * token; this function is responsible for checking the token and marking the
 * email as verified if it matches. Note it is a `SECURITY DEFINER` function,
 * which means it runs with the security of the user that defined the function
 * (which is the database owner) - i.e. it can do anything the database owner
 * can do. This means we have to be very careful what we put in the function,
 * and make sure that it checks that the user is allowed to do what they're
 * trying to do - in this case, we do that check by ensuring the token matches.
 */
create function app_public.verify_email(user_email_id uuid, token text) returns boolean as $$
begin
  update app_public.user_emails
  set
    is_verified = true,
    is_primary = is_primary or not exists(
      select 1 from app_public.user_emails other_email where other_email.user_id = user_emails.user_id and other_email.is_primary is true
    )
  where id = user_email_id
  and exists(
    select 1 from app_private.user_email_secrets where user_email_secrets.user_email_id = user_emails.id and verification_token = token
  );
  return found;
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_public.verify_email(user_email_id uuid, token text) is
  E'Once you have received a verification token for your email, you may call this mutation with that token to make your email verified.';

/*
 * When the users first email address is verified we will mark their account as
 * verified, which can unlock additional features that were gated behind an
 * `isVerified` check.
 */

create function app_public.tg_user_emails__verify_account_on_verified() returns trigger as $$
begin
  update app_public.users set is_verified = true where id = new.user_id and is_verified is false;
  return new;
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;

create trigger _500_verify_account_on_verified
  after insert or update of is_verified
  on app_public.user_emails
  for each row
  when (new.is_verified is true)
  execute procedure app_public.tg_user_emails__verify_account_on_verified();

--! split: 0150-user_auth.sql
/*
 * In addition to logging in with username/email and password, users may use
 * other authentication methods, such as "social login" (OAuth) with GitHub,
 * Twitter, Facebook, etc. We store details of these logins to the
 * user_authentications and user_authentication_secrets tables.
 *
 * The user is allowed to delete entries in this table (which will unlink them
 * from that service), but adding records to the table requires elevated
 * privileges (it's managed by the `installPassportStrategy.ts` middleware,
 * which calls out to the `app_private.link_or_register_user` database
 * function).
 */
create table app_public.user_authentications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_public.users on delete cascade,
  service text not null,
  identifier text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uniq_user_authentications unique(service, identifier)
);

alter table app_public.user_authentications enable row level security;

-- Make it efficient to find all the authentications for a particular user.
create index on app_public.user_authentications(user_id);

-- Keep created_at and updated_at up to date.
create trigger _100_timestamps
  before insert or update on app_public.user_authentications
  for each row
  execute procedure app_private.tg__timestamps();

comment on table app_public.user_authentications is
  E'Contains information about the login providers this user has used, so that they may disconnect them should they wish.';
comment on column app_public.user_authentications.service is
  E'The login service used, e.g. `twitter` or `github`.';
comment on column app_public.user_authentications.identifier is
  E'A unique identifier for the user within the login service.';
comment on column app_public.user_authentications.details is
  E'Additional profile details extracted from this login method';

-- Users may view and delete their social logins.
create policy select_own on app_public.user_authentications for select using (user_id = app_public.current_user_id());
create policy delete_own on app_public.user_authentications for delete using (user_id = app_public.current_user_id());
-- TODO: on delete, check this isn't the last one, or that they have a verified
-- email address or password. For now we're not worrying about that since all
-- the OAuth providers we use verify the email address.

-- Notify the user if a social login is removed.
create trigger _500_audit_removed
  after delete on app_public.user_authentications
  for each row
  execute procedure app_private.tg__add_audit_job(
    'unlinked_account',
    'user_id',
    'service',
    'identifier'
  );
-- NOTE: we don't need to notify when a linked account is added here because
-- that's handled in the link_or_register_user function.

grant select on app_public.user_authentications to :DATABASE_VISITOR;
grant delete on app_public.user_authentications to :DATABASE_VISITOR;

/**********/

-- This table contains secret information for each user_authentication; could
-- be things like access tokens, refresh tokens, profile information. Whatever
-- the passport strategy deems necessary.
create table app_private.user_authentication_secrets (
  user_authentication_id uuid not null primary key references app_public.user_authentications on delete cascade,
  details jsonb not null default '{}'::jsonb
);
alter table app_private.user_authentication_secrets enable row level security;

-- NOTE: user_authentication_secrets doesn't need an auto-inserter as we handle
-- that everywhere that can create a user_authentication row.
/*
 * This function handles logging in a user with their username (or email
 * address) and password.
 *
 * Note that it is not in app_public; this function is intended to be called
 * with elevated privileges (namely from `PassportLoginPlugin.ts`). The reason
 * for this is because we want to be able to track failed login attempts (to
 * help protect user accounts). If this were callable by a user, they could
 * roll back the transaction when a login fails and no failed attempts would be
 * logged, effectively giving them infinite retries. We want to disallow this,
 * so we only let code call into `login` that we trust to not roll back the
 * transaction afterwards.
 */
create function app_private.login(username citext, password text) returns app_private.sessions as $$
declare
  v_user app_public.users;
  v_user_secret app_private.user_secrets;
  v_login_attempt_window_duration interval = interval '5 minutes';
  v_session app_private.sessions;
begin
  if username like '%@%' then
    -- It's an email
    select users.* into v_user
    from app_public.users
    inner join app_public.user_emails
    on (user_emails.user_id = users.id)
    where user_emails.email = login.username
    order by
      user_emails.is_verified desc, -- Prefer verified email
      user_emails.created_at asc -- Failing that, prefer the first registered (unverified users _should_ verify before logging in)
    limit 1;
  else
    -- It's a username
    select users.* into v_user
    from app_public.users
    where users.username = login.username;
  end if;

  if v_user is null then
    -- No user with that email/username was found
    return null;
  end if;

  -- Load their secrets
  select * into v_user_secret from app_private.user_secrets
  where user_secrets.user_id = v_user.id;

  -- Have there been too many login attempts?
  if (
    v_user_secret.first_failed_password_attempt is not null
  and
    v_user_secret.first_failed_password_attempt > NOW() - v_login_attempt_window_duration
  and
    v_user_secret.failed_password_attempts >= 3
  ) then
    raise exception 'User account locked - too many login attempts. Try again after 5 minutes.' using errcode = 'LOCKD';
  end if;

  -- Not too many login attempts, let's check the password.
  -- `password_hash` is null for accounts created without a password (OAuth sign-up).
  -- `!=` evaluates to null there and would skip the reject branch, so the success
  -- path must be a positive match: a null hash always rejects.
  if v_user_secret.password_hash is null
     or v_user_secret.password_hash is distinct from crypt(password, v_user_secret.password_hash) then
    -- Wrong password, bump all the attempt tracking figures
    update app_private.user_secrets
    set
      failed_password_attempts = (case when first_failed_password_attempt is null or first_failed_password_attempt < now() - v_login_attempt_window_duration then 1 else failed_password_attempts + 1 end),
      first_failed_password_attempt = (case when first_failed_password_attempt is null or first_failed_password_attempt < now() - v_login_attempt_window_duration then now() else first_failed_password_attempt end)
    where user_id = v_user.id;
    return null; -- Must not throw otherwise transaction will be aborted and attempts won't be recorded
  end if;

  -- Excellent - they're logged in! Let's reset the attempt tracking
  update app_private.user_secrets
  set failed_password_attempts = 0, first_failed_password_attempt = null, last_login_at = now()
  where user_id = v_user.id;
  -- Create a session for the user
  insert into app_private.sessions (user_id) values (v_user.id) returning * into v_session;
  -- And finally return the session
  return v_session;
end;
$$ language plpgsql strict volatile;

comment on function app_private.login(username citext, password text) is
  E'Returns a user that matches the username/password combo, or null on failure.';
/*
 * Logging out deletes the session, and clears the session_id in the
 * transaction. This is a `SECURITY DEFINER` function, so we check that the
 * user is allowed to do it by matching the current_session_id().
 */
create function app_public.logout() returns void as $$
begin
  -- Delete the session
  delete from app_private.sessions where id = app_public.current_session_id();
  -- Clear the identifier from the transaction
  perform set_config('my.session_id', '', true);
end;
$$ language plpgsql security definer volatile set search_path to pg_catalog, public, pg_temp;
/*
 * When a user forgets their password we want to let them set a new one; but we
 * need to be very careful with this. We don't want to reveal whether or not an
 * account exists by the email address, so we email the entered email address
 * whether or not it's registered. If it's not registered, we track these
 * attempts in `unregistered_email_password_resets` to ensure that we don't
 * allow spamming the address; otherwise we store it to `user_email_secrets`.
 *
 * `app_public.forgot_password` is responsible for checking these things and
 * queueing a reset password token to be emailed to the user. For what happens
 * after the user receives this email, see instead `app_private.reset_password`.
 *
 * NOTE: unlike app_private.login and app_private.reset_password, rolling back
 * the results of this function will not cause any security issues so we do not
 * need to call it indirectly as we do for those other functions. (Rolling back
 * will undo the tracking of when we sent the email but it will also prevent
 * the email being sent, so it's harmless.)
 */

create table app_private.unregistered_email_password_resets (
  email citext constraint unregistered_email_pkey primary key,
  attempts int not null default 1,
  latest_attempt timestamptz not null
);
comment on table app_private.unregistered_email_password_resets is
  E'If someone tries to recover the password for an email that is not registered in our system, this table enables us to rate-limit outgoing emails to avoid spamming.';
comment on column app_private.unregistered_email_password_resets.attempts is
  E'We store the number of attempts to help us detect accounts being attacked.';
comment on column app_private.unregistered_email_password_resets.latest_attempt is
  E'We store the time the last password reset was sent to this email to prevent the email getting flooded.';

/**********/

create function app_public.forgot_password(email citext) returns void as $$
declare
  v_user_email app_public.user_emails;
  v_token text;
  v_token_min_duration_between_emails interval = interval '3 minutes';
  v_token_max_duration interval = interval '3 days';
  v_now timestamptz = clock_timestamp(); -- Function can be called multiple during transaction
  v_latest_attempt timestamptz;
begin
  -- Find the matching user_email:
  select user_emails.* into v_user_email
  from app_public.user_emails
  where user_emails.email = forgot_password.email
  order by is_verified desc, id desc;

  -- If there is no match:
  if v_user_email is null then
    -- This email doesn't exist in the system; trigger an email stating as much.

    -- We do not allow this email to be triggered more than once every 15
    -- minutes, so we need to track it:
    insert into app_private.unregistered_email_password_resets (email, latest_attempt)
      values (forgot_password.email, v_now)
      on conflict on constraint unregistered_email_pkey
      do update
        set latest_attempt = v_now, attempts = unregistered_email_password_resets.attempts + 1
        where unregistered_email_password_resets.latest_attempt < v_now - interval '15 minutes'
      returning latest_attempt into v_latest_attempt;

    if v_latest_attempt = v_now then
      perform graphile_worker.add_job(
        'user__forgot_password_unregistered_email',
        json_build_object('email', forgot_password.email::text)
      );
    end if;

    -- TODO: we should clear out the unregistered_email_password_resets table periodically.

    return;
  end if;

  -- There was a match.
  -- See if we've triggered a reset recently:
  if exists(
    select 1
    from app_private.user_email_secrets
    where user_email_id = v_user_email.id
    and password_reset_email_sent_at is not null
    and password_reset_email_sent_at > v_now - v_token_min_duration_between_emails
  ) then
    -- If so, take no action.
    return;
  end if;

  -- Fetch or generate reset token:
  update app_private.user_secrets
  set
    reset_password_token = (
      case
      when reset_password_token is null or reset_password_token_generated < v_now - v_token_max_duration
      then encode(gen_random_bytes(7), 'hex')
      else reset_password_token
      end
    ),
    reset_password_token_generated = (
      case
      when reset_password_token is null or reset_password_token_generated < v_now - v_token_max_duration
      then v_now
      else reset_password_token_generated
      end
    )
  where user_id = v_user_email.user_id
  returning reset_password_token into v_token;

  -- Don't allow spamming an email:
  update app_private.user_email_secrets
  set password_reset_email_sent_at = v_now
  where user_email_id = v_user_email.id;

  -- Trigger email send:
  perform graphile_worker.add_job(
    'user__forgot_password',
    json_build_object('id', v_user_email.user_id, 'email', v_user_email.email::text, 'token', v_token)
  );

end;
$$ language plpgsql strict security definer volatile set search_path to pg_catalog, public, pg_temp;

comment on function app_public.forgot_password(email public.citext) is
  E'If you''ve forgotten your password, give us one of your email addresses and we''ll send you a reset token. Note this only works if you have added an email address!';
/*
 * This is the second half of resetting a users password, please see
 * `app_public.forgot_password` for the first half.
 *
 * The `app_private.reset_password` function checks the reset token is correct
 * and sets the user's password to be the newly provided password, assuming
 * `assert_valid_password` is happy with it. If the attempt fails, this is
 * logged to avoid a brute force attack. Since we cannot risk this tracking
 * being lost (e.g. by a later error rolling back the transaction), we put this
 * function into app_private and explicitly call it from the `resetPassword`
 * field in `PassportLoginPlugin.ts`.
 */

create function app_private.assert_valid_password(new_password text) returns void as $$
begin
  -- TODO: add better assertions!
  if length(new_password) < 8 then
    raise exception 'Password is too weak' using errcode = 'WEAKP';
  end if;
end;
$$ language plpgsql volatile;

create function app_private.reset_password(user_id uuid, reset_token text, new_password text) returns app_private.sessions as $$
declare
  v_user app_public.users;
  v_user_secret app_private.user_secrets;
  v_token_max_duration interval = interval '3 days';
  v_session app_private.sessions;
begin
  select users.* into v_user
  from app_public.users
  where id = user_id;

  if v_user is null then
    return null;
  end if;

  -- Load their secrets
  select * into v_user_secret from app_private.user_secrets
  where user_secrets.user_id = v_user.id;

  -- Have there been too many reset attempts?
  if (
    v_user_secret.first_failed_reset_password_attempt is not null
  and
    v_user_secret.first_failed_reset_password_attempt > NOW() - v_token_max_duration
  and
    v_user_secret.failed_reset_password_attempts >= 20
  ) then
    raise exception 'Password reset locked - too many reset attempts' using errcode = 'LOCKD';
  end if;

  -- Not too many reset attempts, let's check the token
  if v_user_secret.reset_password_token is null
     or v_user_secret.reset_password_token is distinct from reset_token then
    -- Wrong token, bump all the attempt tracking figures
    update app_private.user_secrets
    set
      failed_reset_password_attempts = (case when first_failed_reset_password_attempt is null or first_failed_reset_password_attempt < now() - v_token_max_duration then 1 else failed_reset_password_attempts + 1 end),
      first_failed_reset_password_attempt = (case when first_failed_reset_password_attempt is null or first_failed_reset_password_attempt < now() - v_token_max_duration then now() else first_failed_reset_password_attempt end)
    where user_secrets.user_id = v_user.id;
    return null;
  end if;

  -- Excellent - they're legit
  -- perform app_private.assert_valid_password(new_password);

  -- Let's reset the password as requested
  update app_private.user_secrets
  set
    password_hash = crypt(new_password, gen_salt('bf')),
    failed_password_attempts = 0,
    first_failed_password_attempt = null,
    reset_password_token = null,
    reset_password_token_generated = null,
    failed_reset_password_attempts = 0,
    first_failed_reset_password_attempt = null
  where user_secrets.user_id = v_user.id;

  -- Revoke the users' sessions
  delete from app_private.sessions
  where sessions.user_id = v_user.id;

  -- Notify user their password was reset
  perform graphile_worker.add_job(
    'user__audit',
    json_build_object(
      'type', 'reset_password',
      'user_id', v_user.id,
      'current_user_id', app_public.current_user_id()
    ));

  -- Create a new session for the user
  insert into app_private.sessions (user_id) values (v_user.id) returning * into v_session;
  return v_session;
end;
$$ language plpgsql strict volatile;
/*
 * For security reasons we don't want to allow a user to just delete their user
 * account without confirmation; so we have them request deletion, receive an
 * email, and then click the link in the email and press a button to confirm
 * deletion. This function handles the first step in this process; see
 * `app_public.confirm_account_deletion` for the second half.
 */

create function app_public.request_account_deletion() returns boolean as $$
declare
  v_user_email app_public.user_emails;
  v_token text;
  v_token_max_duration interval = interval '3 days';
begin
  if app_public.current_user_id() is null then
    raise exception 'You must log in to delete your account' using errcode = 'LOGIN';
  end if;

  -- Get the email to send account deletion token to
  select * into v_user_email
    from app_public.user_emails
    where user_id = app_public.current_user_id()
    order by is_primary desc, is_verified desc, id desc
    limit 1;

  -- Fetch or generate token
  update app_private.user_secrets
  set
    delete_account_token = (
      case
      when delete_account_token is null or delete_account_token_generated < NOW() - v_token_max_duration
      then encode(gen_random_bytes(7), 'hex')
      else delete_account_token
      end
    ),
    delete_account_token_generated = (
      case
      when delete_account_token is null or delete_account_token_generated < NOW() - v_token_max_duration
      then now()
      else delete_account_token_generated
      end
    )
  where user_id = app_public.current_user_id()
  returning delete_account_token into v_token;

  -- Trigger email send
  perform graphile_worker.add_job('user__send_delete_account_email', json_build_object('email', v_user_email.email::text, 'token', v_token));
  return true;
end;
$$ language plpgsql strict security definer volatile set search_path to pg_catalog, public, pg_temp;

comment on function app_public.request_account_deletion() is
  E'Begin the account deletion flow by requesting the confirmation email';
/*
 * This is the second half of the account deletion process, for the first half
 * see `app_public.request_account_deletion`.
 */
create function app_public.confirm_account_deletion(token text) returns boolean as $$
declare
  v_user_secret app_private.user_secrets;
  v_token_max_duration interval = interval '3 days';
begin
  if app_public.current_user_id() is null then
    raise exception 'You must log in to delete your account' using errcode = 'LOGIN';
  end if;

  select * into v_user_secret
    from app_private.user_secrets
    where user_secrets.user_id = app_public.current_user_id();

  if v_user_secret is null then
    -- Success: they're already deleted
    return true;
  end if;

  -- Check the token
  if (
    -- token is still valid
    v_user_secret.delete_account_token_generated > now() - v_token_max_duration
  and
    -- token matches
    v_user_secret.delete_account_token = token
  ) then
    -- Token passes; delete their account :(
    delete from app_public.users where id = app_public.current_user_id();
    return true;
  end if;

  raise exception 'The supplied token was incorrect - perhaps you''re logged in to the wrong account, or the token has expired?' using errcode = 'DNIED';
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.confirm_account_deletion(token text) is
  E'If you''re certain you want to delete your account, use `requestAccountDeletion` to request an account deletion token, and then supply the token through this mutation to complete account deletion.';
/*
 * To change your password you must specify your previous password. The form in
 * the web UI may confirm that the new password was typed correctly by making
 * the user type it twice, but that isn't necessary in the API.
 */

create function app_public.change_password(old_password text, new_password text) returns boolean as $$
declare
  v_user app_public.users;
  v_user_secret app_private.user_secrets;
begin
  select users.* into v_user
  from app_public.users
  where id = app_public.current_user_id();

  if v_user is null then
    raise exception 'You must log in to change your password' using errcode = 'LOGIN';
  end if;

  -- Load their secrets
  select * into v_user_secret from app_private.user_secrets
  where user_secrets.user_id = v_user.id;

  if v_user_secret.password_hash is null
     or v_user_secret.password_hash is distinct from crypt(old_password, v_user_secret.password_hash) then
    raise exception 'Incorrect password' using errcode = 'CREDS';
  end if;
  -- perform app_private.assert_valid_password(new_password);

  -- Reset the password as requested
  update app_private.user_secrets
  set
    password_hash = crypt(new_password, gen_salt('bf'))
  where user_secrets.user_id = v_user.id;

  -- Revoke all other sessions
  delete from app_private.sessions
  where sessions.user_id = v_user.id
  and sessions.id <> app_public.current_session_id();

  -- Notify user their password was changed
  perform graphile_worker.add_job(
    'user__audit',
    json_build_object(
      'type', 'change_password',
      'user_id', v_user.id,
      'current_user_id', app_public.current_user_id()
    ));

  return true;
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.change_password(old_password text, new_password text) is
  E'Enter your old password and a new password to change your password.';

grant execute on function app_public.change_password(text, text) to :DATABASE_VISITOR;
/*
 * A user account may be created explicitly via the GraphQL `register` mutation
 * (which calls `really_create_user` below), or via OAuth (which, via
 * `installPassportStrategy.ts`, calls link_or_register_user below, which may
 * then call really_create_user). Ultimately `really_create_user` is called in
 * all cases to create a user account within our system, so it must do
 * everything we'd expect in this case including validating username/password,
 * setting the password (if any), storing the email address, etc.
 */

create function app_private.really_create_user(
  username citext,
  name text,
  avatar_url text,
  email_is_verified bool,
  email text default null,
  password text default null
) returns app_public.users as $$
declare
  v_user app_public.users;
  v_username citext = username;
begin
  -- if password is not null then
  --   perform app_private.assert_valid_password(password);
  -- end if;
  -- if email is null then
  --   raise exception 'Email is required' using errcode = 'MODAT';
  -- end if;

  -- Insert the new user
  insert into app_public.users (username, name, avatar_url) values
    (v_username, name, avatar_url)
    returning * into v_user;

  -- Add the user's email
  if email is not null then
    insert into app_public.user_emails (user_id, email, is_verified, is_primary) values
      (v_user.id, email, email_is_verified, email_is_verified);
  end if;

  -- Store the password
  if password is not null then
    update app_private.user_secrets
    set password_hash = crypt(password, gen_salt('bf'))
    where user_id = v_user.id;
  end if;

  -- Refresh the user
  select * into v_user from app_public.users where id = v_user.id;

  return v_user;
end;
$$ language plpgsql volatile set search_path to pg_catalog, public, pg_temp;

comment on function app_private.really_create_user(username citext, name text, avatar_url text, email_is_verified bool, email text, password text) is
  E'Creates a user account. All arguments are optional, it trusts the calling method to perform sanitisation.';

/**********/

/*
 * The `register_user` function is called by `link_or_register_user` when there
 * is no matching user to link the login to, so we want to register the user
 * using OAuth or similar credentials.
 */

create function app_private.register_user(
  f_service character varying,
  f_identifier character varying,
  f_profile json,
  f_auth_details json,
  f_email_is_verified boolean default false
) returns app_public.users as $$
declare
  v_user app_public.users;
  v_email citext;
  v_name text;
  v_username citext;
  v_avatar_url text;
  v_user_authentication_id uuid;
begin
  -- Extract data from the user’s OAuth profile data.
  v_email := f_profile ->> 'email';
  v_name := f_profile ->> 'name';
  v_username := f_profile ->> 'username';
  v_avatar_url := f_profile ->> 'avatar_url';

  -- Sanitise the username, and make it unique if necessary.
  if v_username is null then
    v_username = coalesce(v_name, 'user');
  end if;
  v_username = regexp_replace(v_username, '^[^a-z]+', '', 'gi');
  v_username = regexp_replace(v_username, '[^a-z0-9]+', '_', 'gi');
  if v_username is null or length(v_username) < 3 then
    v_username = 'user';
  end if;
  select (
    case
    when i = 0 then v_username
    else v_username || i::text
    end
  ) into v_username from generate_series(0, 1000) i
  where not exists(
    select 1
    from app_public.users
    where users.username = (
      case
      when i = 0 then v_username
      else v_username || i::text
      end
    )
  )
  limit 1;

  -- Create the user account
  v_user = app_private.really_create_user(
    username => v_username,
    email => v_email,
    email_is_verified => f_email_is_verified,
    name => v_name,
    avatar_url => v_avatar_url
  );

  -- Insert the user’s private account data (e.g. OAuth tokens)
  insert into app_public.user_authentications (user_id, service, identifier, details) values
    (v_user.id, f_service, f_identifier, f_profile) returning id into v_user_authentication_id;
  insert into app_private.user_authentication_secrets (user_authentication_id, details) values
    (v_user_authentication_id, f_auth_details);

  return v_user;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_private.register_user(f_service character varying, f_identifier character varying, f_profile json, f_auth_details json, f_email_is_verified boolean) is
  E'Used to register a user from information gleaned from OAuth. Primarily used by link_or_register_user';

/**********/

/*
 * The `link_or_register_user` function is called from
 * `installPassportStrategy.ts` when a user logs in with a social login
 * provider (OAuth), e.g. GitHub, Facebook, etc. If the user is already logged
 * in then the new provider will be linked to the users account, otherwise we
 * will try to retrieve an existing account using these details (matching the
 * service/identifier or the email address), and failing that we will register
 * a new user account linked to this service via the `register_user` function.
 *
 * This function is also responsible for keeping details in sync with the login
 * provider whenever the user logs in; you'll see this in the `update`
 * statemets towards the bottom of the function.
 */

create function app_private.link_or_register_user(
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
    elsif v_email is not null then
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
    return app_private.register_user(f_service, f_identifier, f_profile, f_auth_details, true);
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

comment on function app_private.link_or_register_user(f_user_id uuid, f_service character varying, f_identifier character varying, f_profile json, f_auth_details json) is
  E'If you''re logged in, this will link an additional OAuth login to your account if necessary. If you''re logged out it may find if an account already exists (based on OAuth details or email address) and return that, or create a new user account if necessary.';
/*
 * The user is only allowed to have one primary email, and that email must be
 * verified. This function lets the user change which of their verified emails
 * is the primary email.
 */

create function app_public.make_email_primary(email_id uuid) returns app_public.user_emails as $$
declare
  v_user_email app_public.user_emails;
begin
  select * into v_user_email from app_public.user_emails where id = email_id and user_id = app_public.current_user_id();
  if v_user_email is null then
    raise exception 'That''s not your email' using errcode = 'DNIED';
    return null;
  end if;
  if v_user_email.is_verified is false then
    raise exception 'You may not make an unverified email primary' using errcode = 'VRFY1';
  end if;
  update app_public.user_emails set is_primary = false where user_id = app_public.current_user_id() and is_primary is true and id <> email_id;
  update app_public.user_emails set is_primary = true where user_id = app_public.current_user_id() and is_primary is not true and id = email_id returning * into v_user_email;
  return v_user_email;
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_public.make_email_primary(email_id uuid) is
  E'Your primary email is where we''ll notify of account events; other emails may be used for discovery or login. Use this when you''re changing your email address.';
/*
 * If you don't receive the email verification email, you can trigger a resend
 * with this function.
 */
create function app_public.resend_email_verification_code(email_id uuid) returns boolean as $$
begin
  if exists(
    select 1
    from app_public.user_emails
    where user_emails.id = email_id
    and user_id = app_public.current_user_id()
    and is_verified is false
  ) then
    perform graphile_worker.add_job('user_emails__send_verification', json_build_object('id', email_id));
    return true;
  end if;
  return false;
end;
$$ language plpgsql strict volatile security definer set search_path to pg_catalog, public, pg_temp;
comment on function app_public.resend_email_verification_code(email_id uuid) is
  E'If you didn''t receive the verification code for this email, we can resend it. We silently cap the rate of resends on the backend, so calls to this function may not result in another email being sent if it has been called recently.';

create function app_private.set_password(
  user_id uuid,
  password text
) returns void as $$
begin
  update app_private.user_secrets
  set password_hash = crypt(password, gen_salt('bf'))
  where user_secrets.user_id = set_password.user_id;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

--! split: 0180-families.sql
drop function if exists app_public.transfer_family_billing_contact(uuid, uuid);
drop function if exists app_public.transfer_family_ownership(uuid, uuid);
drop function if exists app_public.delete_family(uuid);
drop function if exists app_public.remove_from_family(uuid, uuid);
drop function if exists app_public.families_current_user_is_billing_contact(app_public.families);
drop function if exists app_public.families_current_user_is_owner(app_public.families);
drop function if exists app_public.accept_invitation_to_family(uuid, text) cascade;
drop function if exists app_public.get_family_for_invitation(uuid, text) cascade;
drop function if exists app_public.family_for_invitation(uuid, text) cascade;
drop function if exists app_private.create_qr_invite(uuid, text) cascade;
drop function if exists app_private.create_qr_invite(uuid) cascade;
drop function if exists app_public.invite_user_to_family(uuid, uuid) cascade;
drop function if exists app_public.invite_to_family(uuid, citext, citext, text) cascade;
drop function if exists app_public.invite_to_family(uuid, citext, citext) cascade;
drop function if exists app_public.current_user_invited_family_ids() cascade;
drop function if exists app_public.current_user_member_family_ids() cascade;
drop table if exists app_public.family_invitations;
drop table if exists app_public.family_memberships;
drop table if exists app_public.families cascade;

--------------------------------------------------------------------------------

create table app_public.families (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);
alter table app_public.families enable row level security;

grant select, insert, delete, update(name, slug) on app_public.families to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create table app_public.family_memberships (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families on delete cascade,
  user_id uuid not null references app_public.users on delete cascade,
  is_owner boolean not null default false,
  is_billing_contact boolean not null default false,
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);
alter table app_public.family_memberships enable row level security;

create index on app_public.family_memberships (user_id);

grant select, insert, delete on app_public.family_memberships to :DATABASE_VISITOR;

--------------------------------------------------------------------------------

create table app_public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families on delete cascade,
  code text,
  user_id uuid references app_public.users on delete cascade,
  email citext,
  invited_role text check (invited_role in ('parent', 'student')),
  expires_at timestamptz,
  check (user_id is not null or email is not null or code is not null),
  unique (family_id, user_id),
  unique (family_id, email)
);
alter table app_public.family_invitations enable row level security;

create index on app_public.family_invitations(user_id);

-- Admin/teacher can see and manage all family invitations
create policy select_admin on app_public.family_invitations for select
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy insert_admin on app_public.family_invitations for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.family_invitations for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.family_invitations for update
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, delete, update(invited_role) on app_public.family_invitations to :DATABASE_VISITOR;

--------------------------------------------------------------------------------
create function app_public.current_user_member_family_ids() returns setof uuid as $$
  select family_id from app_public.family_memberships
    where user_id = app_public.current_user_id();
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.current_user_invited_family_ids() returns setof uuid as $$
  select family_id from app_public.family_invitations
    where user_id = app_public.current_user_id();
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

create policy select_member on app_public.families
  for select using (id in (select app_public.current_user_member_family_ids()));

create policy select_invited on app_public.families
  for select using (id in (select app_public.current_user_invited_family_ids()));

create policy insert_admin on app_public.families for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.families for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

create policy select_member on app_public.family_memberships
  for select using (family_id in (select app_public.current_user_member_family_ids()));

create policy select_invited on app_public.family_memberships
  for select using (family_id in (select app_public.current_user_invited_family_ids()));

create policy insert_admin on app_public.family_memberships for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.family_memberships for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

--------------------------------------------------------------------------------
create function app_public.create_family(slug citext, name text) returns app_public.families as $$
declare
  v_org app_public.families;
begin
  insert into app_public.families (slug, name) values (slug, name) returning * into v_org;
  insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
    values(v_org.id, app_public.current_user_id(), true, true);
  return v_org;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.invite_to_family(family_id uuid, username citext = null, email citext = null, invited_role text = 'parent')
  returns void as $$
declare
  v_code text;
  v_user app_public.users;
begin
  -- Are we allowed to add this person
  -- Are we logged in
  if app_public.current_user_id() is null then
    raise exception 'You must log in to invite a user' using errcode = 'LOGIN';
  end if;

  select * into v_user from app_public.users where users.username = invite_to_family.username;

  -- Are we the owner of this family
  if not exists(
    select 1 from app_public.family_memberships
      where family_memberships.family_id = invite_to_family.family_id
      and family_memberships.user_id = app_public.current_user_id()
      and is_owner is true
  ) then
    raise exception 'You''re not the owner of this family' using errcode = 'DNIED';
  end if;

  if v_user.id is not null and exists(
    select 1 from app_public.family_memberships
      where family_memberships.family_id = invite_to_family.family_id
      and family_memberships.user_id = v_user.id
  ) then
    raise exception 'Cannot invite someone who is already a member' using errcode = 'ISMBR';
  end if;

  if email is not null then
    v_code = encode(gen_random_bytes(7), 'hex');
  end if;

  if v_user.id is not null and not v_user.is_verified then
    raise exception 'The user you attempted to invite has not verified their account' using errcode = 'VRFY2';
  end if;

  if v_user.id is null and email is null then
    raise exception 'Could not find person to invite' using errcode = 'NTFND';
  end if;

  -- Invite the user
  insert into app_public.family_invitations(family_id, user_id, email, code, invited_role)
    values (invite_to_family.family_id, v_user.id, email, v_code, invite_to_family.invited_role);
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

create function app_private.create_qr_invite(family_id uuid, invited_role text = 'parent')
  returns app_public.family_invitations as $$
declare
  v_invitation app_public.family_invitations;
begin
  insert into app_public.family_invitations(family_id, code, invited_role, expires_at)
    values (
      create_qr_invite.family_id,
      encode(gen_random_bytes(12), 'hex'),
      create_qr_invite.invited_role,
      now() + interval '24 hours'
    )
    returning * into v_invitation;
  return v_invitation;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

create function app_public.family_for_invitation(invitation_id uuid, code text = null)
  returns app_public.families as $$
declare
  v_invitation app_public.family_invitations;
  v_family app_public.families;
begin
  if app_public.current_user_id() is null then
    raise exception 'You must log in to accept an invitation' using errcode = 'LOGIN';
  end if;

  select * into v_invitation from app_public.family_invitations where id = invitation_id;

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

create function app_public.accept_invitation_to_family(invitation_id uuid, code text = null)
  returns void as $$
declare
  v_family app_public.families;
begin
  v_family = app_public.family_for_invitation(invitation_id, code);

  -- Accept the user into the family
  insert into app_public.family_memberships (family_id, user_id)
    values(v_family.id, app_public.current_user_id())
    on conflict do nothing;

  -- Delete the invitation
  delete from app_public.family_invitations where id = invitation_id;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;

--------------------------------------------------------------------------------

create trigger _500_send_email after insert on app_public.family_invitations
  for each row execute procedure app_private.tg__add_job('family_invitations__send_invite');

--------------------------------------------------------------------------------

create function app_public.families_current_user_is_owner(
  org app_public.families
) returns boolean as $$
  select exists(
    select 1
    from app_public.family_memberships
    where family_id = org.id
    and user_id = app_public.current_user_id()
    and is_owner is true
  )
$$ language sql stable;

create function app_public.families_current_user_is_billing_contact(
  org app_public.families
) returns boolean as $$
  select exists(
    select 1
    from app_public.family_memberships
    where family_id = org.id
    and user_id = app_public.current_user_id()
    and is_billing_contact is true
  )
$$ language sql stable;

create policy update_owner on app_public.families for update using (exists(
  select 1
  from app_public.family_memberships
  where family_id = families.id
  and user_id = app_public.current_user_id()
  and is_owner is true
));

create function app_public.remove_from_family(
  family_id uuid,
  user_id uuid
) returns void as $$
declare
  v_my_membership app_public.family_memberships;
begin
  select * into v_my_membership
    from app_public.family_memberships
    where family_memberships.family_id = remove_from_family.family_id
    and family_memberships.user_id = app_public.current_user_id();

  if (v_my_membership is null) then
    -- I'm not a member of that family
    return;
  elsif v_my_membership.is_owner then
    if remove_from_family.user_id <> app_public.current_user_id() then
      -- Delete it
    else
      -- Need to transfer ownership before I can leave
      return;
    end if;
  elsif v_my_membership.user_id = user_id then
    -- Delete it
  else
    -- Not allowed to delete it
    return;
  end if;

  if v_my_membership.is_billing_contact then
    update app_public.family_memberships
      set is_billing_contact = false
      where id = v_my_membership.id
      returning * into v_my_membership;
    update app_public.family_memberships
      set is_billing_contact = true
      where family_memberships.family_id = remove_from_family.family_id
      and family_memberships.is_owner;
  end if;

  delete from app_public.family_memberships
    where family_memberships.family_id = remove_from_family.family_id
    and family_memberships.user_id = remove_from_family.user_id;

end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

--------------------------------------------------------------------------------

create function app_public.tg_users__deletion_family_checks_and_actions() returns trigger as $$
begin
  -- Check they're not an family owner
  if exists(
    select 1
    from app_public.family_memberships
    where user_id = app_public.current_user_id()
    and is_owner is true
  ) then
    raise exception 'You cannot delete your account until you are not the owner of any families.' using errcode = 'OWNER';
  end if;

  -- Reassign billing contact status back to the family owner
  update app_public.family_memberships
    set is_billing_contact = true
    where is_owner = true
    and family_id in (
      select family_id
      from app_public.family_memberships my_memberships
      where my_memberships.user_id = app_public.current_user_id()
      and is_billing_contact is true
    );

  return old;
end;
$$ language plpgsql;

create trigger _500_deletion_family_checks_and_actions
  before delete
  on app_public.users
  for each row
  when (app_public.current_user_id() is not null)
  execute procedure app_public.tg_users__deletion_family_checks_and_actions();

create function app_public.delete_family(family_id uuid) returns void as $$
begin
  if exists(
    select 1
    from app_public.family_memberships
    where user_id = app_public.current_user_id()
    and family_memberships.family_id = delete_family.family_id
    and is_owner is true
  ) then
    delete from app_public.families where id = family_id;
  end if;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

create function app_public.transfer_family_ownership(
  family_id uuid,
  user_id uuid
) returns app_public.families as $$
declare
 v_org app_public.families;
begin
  if exists(
    select 1
    from app_public.family_memberships
    where family_memberships.user_id = app_public.current_user_id()
    and family_memberships.family_id = transfer_family_ownership.family_id
    and is_owner is true
  ) then
    update app_public.family_memberships
      set is_owner = true
      where family_memberships.family_id = transfer_family_ownership.family_id
      and family_memberships.user_id = transfer_family_ownership.user_id;
    if found then
      update app_public.family_memberships
        set is_owner = false
        where family_memberships.family_id = transfer_family_ownership.family_id
        and family_memberships.user_id = app_public.current_user_id();

      select * into v_org from app_public.families where id = family_id;
      return v_org;
    end if;
  end if;
  return null;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

create function app_public.transfer_family_billing_contact(
  family_id uuid,
  user_id uuid
) returns app_public.families as $$
declare
 v_org app_public.families;
begin
  if exists(
    select 1
    from app_public.family_memberships
    where family_memberships.user_id = app_public.current_user_id()
    and family_memberships.family_id = transfer_family_billing_contact.family_id
    and is_owner is true
  ) then
    update app_public.family_memberships
      set is_billing_contact = true
      where family_memberships.family_id = transfer_family_billing_contact.family_id
      and family_memberships.user_id = transfer_family_billing_contact.user_id;
    if found then
      update app_public.family_memberships
        set is_billing_contact = false
        where family_memberships.family_id = transfer_family_billing_contact.family_id
        and family_memberships.user_id <> transfer_family_billing_contact.user_id
        and is_billing_contact = true;

      select * into v_org from app_public.families where id = family_id;
      return v_org;
    end if;
  end if;
  return null;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

--------------------------------------------------------------------------------
-- Bridge function for RLS: returns user IDs of all members in the current
-- user's families (excluding self). Used by app table RLS policies so
-- family members can see each other's data.
create function app_public.current_user_family_member_ids() returns setof uuid as $$
  select fm.user_id from app_public.family_memberships fm
    where fm.family_id in (select app_public.current_user_member_family_ids())
    and fm.user_id <> app_public.current_user_id();
$$ language sql stable security definer set search_path = pg_catalog, public, pg_temp;

--! split: 0210-contact.sql
create table app_public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  instrument text not null,
  format text not null,
  message text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  ip_address text,
  location_country text,
  location_region text,
  location_city text
);

alter table app_public.contact_submissions enable row level security;
create policy admin_all on app_public.contact_submissions
  using (app_public.current_user_role() in ('admin', 'teacher'));
grant select, update on app_public.contact_submissions to :DATABASE_VISITOR;

alter table app_public.contact_submissions
  add constraint contact_message_length check (length(message) <= 10000);

comment on table app_public.contact_submissions is 'Public contact form submissions (no auth required to create).';

--! split: 0220-courses.sql
create table app_public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) >= 1 and length(title) <= 200),
  description text not null default '',
  instrument text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app_public.courses is 'Music lesson courses, each with an instrument focus.';

alter table app_public.courses enable row level security;

grant select on app_public.courses to :DATABASE_VISITOR;

create trigger _timestamps
  before insert or update on app_public.courses
  for each row execute function app_private.tg__timestamps();

--! split: 0222-enrollments.sql
create table app_public.enrollments (
  student_id uuid not null references app_public.users(id) on delete cascade,
  course_id uuid not null references app_public.courses(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (student_id, course_id)
);

alter table app_public.enrollments enable row level security;
grant select, insert, delete on app_public.enrollments to :DATABASE_VISITOR;

comment on table app_public.enrollments is 'Links students to courses they are enrolled in.';

--! split: 0224-modules.sql
create table app_public.modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references app_public.courses(id) on delete cascade,
  title text not null check (length(title) >= 1 and length(title) <= 200),
  sort_order integer not null default 0,
  content jsonb
);

comment on table app_public.modules is 'Ordered subdivisions within a course.';

alter table app_public.modules enable row level security;

grant select on app_public.modules to :DATABASE_VISITOR;

--! split: 0226-materials.sql
create table app_public.materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  original_filename text not null,
  file_path text not null,
  mime_type text not null default 'application/octet-stream',
  file_size bigint not null default 0,
  is_global boolean not null default false,
  uploaded_by uuid references app_public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table app_public.materials is 'Uploaded files/resources (PDFs, audio, etc). Can be global or course-specific.';

alter table app_public.materials enable row level security;
grant select on app_public.materials to :DATABASE_VISITOR;

--! split: 0228-student-materials.sql
create table app_public.student_materials (
  student_id uuid not null references app_public.users(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (student_id, material_id)
);

alter table app_public.student_materials enable row level security;
grant select, insert, update, delete on app_public.student_materials to :DATABASE_VISITOR;

create policy select_admin on app_public.student_materials
  for select using (app_public.current_user_id() = student_id or app_public.current_user_role() in ('admin', 'teacher'));
create policy insert_admin on app_public.student_materials
  for insert with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.student_materials
  for update using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.student_materials
  for delete using (app_public.current_user_role() in ('admin', 'teacher'));

comment on table app_public.student_materials is 'Direct material assignments to individual students (not via course).';

--! split: 0230-module-materials.sql
create table app_public.module_materials (
  module_id uuid not null references app_public.modules(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (module_id, material_id)
);

alter table app_public.module_materials enable row level security;
grant select on app_public.module_materials to :DATABASE_VISITOR;

comment on table app_public.module_materials is 'Join table linking materials to course modules.';

--! split: 0250-rls-curriculum.sql
-- courses: students see enrolled, parents see family-enrolled, admins see all
alter table app_public.courses enable row level security;
create policy select_enrolled on app_public.courses for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or id in (
      select course_id from app_public.enrollments
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );
create policy insert_admin on app_public.courses for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.courses for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.courses for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));
grant select, insert, update, delete on app_public.courses to :DATABASE_VISITOR;

-- modules: visible via enrolled course (own or family)
alter table app_public.modules enable row level security;
create policy select_via_course on app_public.modules for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or course_id in (
      select course_id from app_public.enrollments
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );
create policy insert_admin on app_public.modules for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.modules for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.modules for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));
grant select, insert, update, delete on app_public.modules to :DATABASE_VISITOR;

-- materials: global, enrolled course (own or family), or directly assigned (own or family)
alter table app_public.materials enable row level security;
create policy select_accessible on app_public.materials for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or is_global
    or id in (
      select mm.material_id from app_public.module_materials mm
      join app_public.modules m on m.id = mm.module_id
      join app_public.enrollments e on e.course_id = m.course_id
      where e.student_id = app_public.current_user_id()
        or e.student_id in (select app_public.current_user_family_member_ids())
    )
    or id in (
      select material_id from app_public.student_materials
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );
create policy insert_admin on app_public.materials for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.materials for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.materials for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));
grant select, insert, update, delete on app_public.materials to :DATABASE_VISITOR;

-- module_materials: visible via enrolled course (own or family)
alter table app_public.module_materials enable row level security;
create policy select_via_module on app_public.module_materials for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or module_id in (
      select m.id from app_public.modules m
      join app_public.enrollments e on e.course_id = m.course_id
      where e.student_id = app_public.current_user_id()
        or e.student_id in (select app_public.current_user_family_member_ids())
    )
  );
create policy insert_admin on app_public.module_materials for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.module_materials for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));
grant select, insert, delete on app_public.module_materials to :DATABASE_VISITOR;

-- enrollments: own, family, or admin
alter table app_public.enrollments enable row level security;
create policy select_own on app_public.enrollments for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );
create policy insert_admin on app_public.enrollments for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.enrollments for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));
grant select, insert, delete on app_public.enrollments to :DATABASE_VISITOR;

-- student_materials: own, family, or admin
alter table app_public.student_materials enable row level security;
create policy select_own on app_public.student_materials for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );
grant select, insert, update, delete on app_public.student_materials to :DATABASE_VISITOR;

--! split: 0260-practice-logs.sql
create table app_public.practice_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  duration_minutes integer,
  rating integer check (rating >= 1 and rating <= 5),
  logged_at timestamptz not null default now()
);

create index practice_logs_student_material on app_public.practice_logs(student_id, material_id);

alter table app_public.practice_logs enable row level security;

grant select, insert, update on app_public.practice_logs to :DATABASE_VISITOR;
grant insert (student_id, material_id, duration_minutes, rating) on app_public.practice_logs to :DATABASE_VISITOR;
grant update (rating) on app_public.practice_logs to :DATABASE_VISITOR;

comment on table app_public.practice_logs is 'Transparent practice tracking per material. Duration captured automatically from AlphaTab playback; rating is optional self-assessment (1-5).';

--! split: 0262-assignment-notes.sql
create table app_public.assignment_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index assignment_notes_student_material on app_public.assignment_notes(student_id, material_id);

alter table app_public.assignment_notes enable row level security;

grant select,
  insert (student_id, material_id, body),
  update (body) on app_public.assignment_notes to :DATABASE_VISITOR;

alter table app_public.assignment_notes
  add constraint assignment_notes_body_length check (length(body) <= 50000);

comment on table app_public.assignment_notes is 'Per-student notes on assigned materials (one per student+material).';

--! split: 0264-messages.sql
create table app_public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references app_public.users(id) on delete cascade,
  recipient_id uuid not null references app_public.users(id) on delete cascade,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index messages_recipient on app_public.messages(recipient_id, created_at desc);
create index messages_sender on app_public.messages(sender_id, created_at desc);

alter table app_public.messages
  add constraint messages_body_length check (length(body) <= 10000);

alter table app_public.messages enable row level security;

grant select,
  insert (sender_id, recipient_id, body),
  update (is_read) on app_public.messages to :DATABASE_VISITOR;

comment on table app_public.messages is 'Direct messages between users (admin<->student communication).';

--! split: 0270-worker-jobs.sql
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

--! split: 0290-rls-interactivity.sql
-- RLS policies for interactivity tables (practice_logs, assignment_notes, messages)
-- Parents get read-only visibility into family students' data.

-- ============================================================================
-- practice_logs: own, family, or admin (insert: own only, update: own only)
-- ============================================================================
alter table app_public.practice_logs enable row level security;

create policy select_own on app_public.practice_logs for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_own on app_public.practice_logs for insert
  with check (student_id = app_public.current_user_id());

create policy insert_admin on app_public.practice_logs for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy update_own on app_public.practice_logs for update
  using (student_id = app_public.current_user_id());

grant select, insert, update on app_public.practice_logs to :DATABASE_VISITOR;

-- ============================================================================
-- assignment_notes: own, family, or admin (insert/update: own only)
-- ============================================================================
alter table app_public.assignment_notes enable row level security;

create policy select_own on app_public.assignment_notes for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_own on app_public.assignment_notes for insert
  with check (student_id = app_public.current_user_id());

create policy update_own on app_public.assignment_notes for update
  using (student_id = app_public.current_user_id());

create policy insert_admin on app_public.assignment_notes for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.assignment_notes for update
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update on app_public.assignment_notes to :DATABASE_VISITOR;

-- ============================================================================
-- messages: sender/recipient, family, or admin
-- Parents can see messages sent to/from their family's students.
-- Insert/update: still only sender/recipient respectively.
-- ============================================================================
alter table app_public.messages enable row level security;

create policy select_own on app_public.messages for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or sender_id = app_public.current_user_id()
    or recipient_id = app_public.current_user_id()
    or sender_id in (select app_public.current_user_family_member_ids())
    or recipient_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_sender on app_public.messages for insert
  with check (sender_id = app_public.current_user_id());

create policy update_recipient on app_public.messages for update
  using (recipient_id = app_public.current_user_id());

create policy insert_admin on app_public.messages for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.messages for update
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update on app_public.messages to :DATABASE_VISITOR;

--! split: 0300-scheduling-enums.sql
-- Scheduling enums used by student_rates, lessons, and lesson_deposits.

create type app_public.lesson_status as enum (
  'scheduled',
  'completed',
  'cancelled',
  'no_show'
);

create type app_public.location_type as enum (
  'in_person_teacher_travels',
  'in_person_student_travels',
  'studio',
  'online'
);

create type app_public.deposit_status as enum ('held', 'refunded', 'captured');

--! split: 0302-student-rates.sql
create table app_public.student_rates (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  rate_cents integer not null,
  lesson_duration_minutes integer not null check (lesson_duration_minutes in (30, 60)),
  location_type app_public.location_type not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, location_type)
);

alter table app_public.student_rates enable row level security;

create trigger _timestamps
  before insert or update on app_public.student_rates
  for each row execute function app_private.tg__timestamps();

grant select on app_public.student_rates to :DATABASE_VISITOR;

alter table app_public.student_rates
  add constraint student_rates_rate_positive check (rate_cents > 0);

comment on table app_public.student_rates is 'Per-student lesson pricing. Rate varies by location type, travel distance, commitment level.';
comment on column app_public.student_rates.rate_cents is 'Lesson price in cents.';
comment on column app_public.student_rates.lesson_duration_minutes is 'Standard lesson length: 30 or 60 minutes.';
comment on column app_public.student_rates.location_type is 'Where the lesson takes place — determines rate.';
comment on column app_public.student_rates.notes is 'Admin notes about this rate (e.g. discount reason).';

--! split: 0304-lessons.sql
create table app_public.lessons (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  gcal_event_id text unique,
  scheduled_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  location_type app_public.location_type not null,
  status app_public.lesson_status not null default 'scheduled',
  cancellation_reason text,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_public.lessons enable row level security;

create index lessons_student_scheduled on app_public.lessons(student_id, scheduled_at);
create index lessons_scheduled_at on app_public.lessons(scheduled_at);

grant select on app_public.lessons to :DATABASE_VISITOR;

comment on table app_public.lessons is 'Scheduled lessons. Google Calendar is the source of truth; scheduled_at is cached for queries.';
comment on column app_public.lessons.gcal_event_id is 'Google Calendar event ID. Nullable for lessons not yet synced; unique when set.';
comment on column app_public.lessons.scheduled_at is 'Lesson start time, cached from Google Calendar.';
comment on column app_public.lessons.status is 'Lifecycle: scheduled -> completed | cancelled | no_show.';
comment on column app_public.lessons.cancellation_reason is 'Why the lesson was cancelled (student, teacher, weather, etc).';
comment on column app_public.lessons.cancelled_at is 'When the lesson was cancelled (for deposit refund policy calculations).';
comment on column app_public.lessons.completed_at is 'When the lesson was marked complete.';

create trigger _timestamps
  before insert or update on app_public.lessons
  for each row execute function app_private.tg__timestamps();

--! split: 0306-lesson-deposits.sql
create table app_public.lesson_deposits (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references app_public.lessons(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  status app_public.deposit_status not null default 'held',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_public.lesson_deposits enable row level security;

grant select on app_public.lesson_deposits to :DATABASE_VISITOR;

comment on table app_public.lesson_deposits is 'Deposit tracking for lessons. 1/3 lesson price held at booking, refunded or captured based on cancellation policy.';
comment on column app_public.lesson_deposits.amount_cents is 'Deposit amount in cents.';
comment on column app_public.lesson_deposits.status is 'Lifecycle: held -> refunded | captured.';

--! split: 0307-rls-scheduling.sql
-- RLS policies for scheduling tables (student_rates, lessons, lesson_deposits)
-- Admin manages all via PgRootDB. Students see own, parents see family.

-- ============================================================================
-- student_rates: own, family, or admin
-- ============================================================================
alter table app_public.student_rates enable row level security;

create policy select_own on app_public.student_rates for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_admin on app_public.student_rates for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.student_rates for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.student_rates for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update, delete on app_public.student_rates to :DATABASE_VISITOR;

-- ============================================================================
-- lessons: own, family, or admin
-- ============================================================================
alter table app_public.lessons enable row level security;

create policy select_own on app_public.lessons for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_admin on app_public.lessons for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.lessons for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.lessons for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update, delete on app_public.lessons to :DATABASE_VISITOR;

-- ============================================================================
-- lesson_deposits: own (via lesson), family (via lesson), or admin
-- ============================================================================
alter table app_public.lesson_deposits enable row level security;

create policy select_own on app_public.lesson_deposits for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or lesson_id in (
      select id from app_public.lessons
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );

create policy insert_admin on app_public.lesson_deposits for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.lesson_deposits for update
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update on app_public.lesson_deposits to :DATABASE_VISITOR;

--! split: 0308-admin-settings.sql
create table app_private.admin_settings (
  key text primary key,
  value jsonb not null
);

comment on table app_private.admin_settings is 'Admin configuration store. Keys: working_hours, google_calendar_id, etc.';

--! split: 0310-lesson-notes.sql
-- Post-lesson notes from teacher to student.

-- ============================================================================
-- lesson_notes: teacher writes notes after each lesson
-- ============================================================================
create table app_public.lesson_notes (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references app_public.lessons(id) on delete cascade,
  topics_covered text,
  homework text,
  progress_observations text,
  notes text,
  material_ids uuid[],
  draft boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger _timestamps
  before insert or update on app_public.lesson_notes
  for each row execute function app_private.tg__timestamps();

-- Grants: read-only for visitors (teacher manages via PgRootDB)
grant select, insert, update, delete on app_public.lesson_notes to :DATABASE_VISITOR;

-- RLS
alter table app_public.lesson_notes enable row level security;

create policy select_own on app_public.lesson_notes for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or (
      draft = false
      and lesson_id in (
        select id from app_public.lessons
        where student_id = app_public.current_user_id()
          or student_id in (select app_public.current_user_family_member_ids())
      )
    )
  );

create policy insert_admin on app_public.lesson_notes for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.lesson_notes for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.lesson_notes for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

-- Comments
comment on table app_public.lesson_notes is 'Post-lesson notes from teacher to student. One per lesson, starts as draft until published.';
comment on column app_public.lesson_notes.lesson_id is 'The lesson these notes are for. Unique — one set of notes per lesson.';
comment on column app_public.lesson_notes.topics_covered is 'What was worked on during the lesson.';
comment on column app_public.lesson_notes.homework is 'What to practice before the next lesson.';
comment on column app_public.lesson_notes.progress_observations is 'How the student is progressing — strengths, areas to improve.';
comment on column app_public.lesson_notes.notes is 'Free-form additional notes.';
comment on column app_public.lesson_notes.material_ids is 'References to library materials attached to these notes.';
comment on column app_public.lesson_notes.draft is 'True while teacher is composing. Students only see published notes (draft = false).';

--! split: 0312-realtime-triggers.sql
-- Realtime triggers: fire pg_notify on changes to app_public tables.
-- The realtimeService LISTENs on fixed channels and fans out via Valkey pub/sub.
-- Subject column values are included in the JSON payload for user resolution.

-- === messages ===
create trigger _900_rt_sender after insert or update or delete on app_public.messages
  for each row execute procedure app_public.tg__graphql_subscription(
    'messageChanged', 'rt:messages', 'sender_id'
  );
create trigger _901_rt_recipient after insert or update or delete on app_public.messages
  for each row execute procedure app_public.tg__graphql_subscription(
    'messageChanged', 'rt:messages', 'recipient_id'
  );

-- === lessons ===
create trigger _900_rt after insert or update or delete on app_public.lessons
  for each row execute procedure app_public.tg__graphql_subscription(
    'lessonChanged', 'rt:lessons', 'student_id'
  );

-- === courses ===
create trigger _900_rt after insert or update or delete on app_public.courses
  for each row execute procedure app_public.tg__graphql_subscription(
    'courseChanged', 'rt:courses', 'id'
  );

-- === modules ===
create trigger _900_rt after insert or update or delete on app_public.modules
  for each row execute procedure app_public.tg__graphql_subscription(
    'moduleChanged', 'rt:modules', 'course_id'
  );

-- === materials ===
create trigger _900_rt after insert or update or delete on app_public.materials
  for each row execute procedure app_public.tg__graphql_subscription(
    'materialChanged', 'rt:materials', 'id'
  );

-- === student_materials ===
create trigger _900_rt after insert or update or delete on app_public.student_materials
  for each row execute procedure app_public.tg__graphql_subscription(
    'studentMaterialChanged', 'rt:student_materials', 'student_id'
  );

-- === module_materials ===
create trigger _900_rt after insert or update or delete on app_public.module_materials
  for each row execute procedure app_public.tg__graphql_subscription(
    'moduleMaterialChanged', 'rt:module_materials', 'module_id'
  );

-- === enrollments ===
create trigger _900_rt after insert or update or delete on app_public.enrollments
  for each row execute procedure app_public.tg__graphql_subscription(
    'enrollmentChanged', 'rt:enrollments', 'student_id'
  );

-- === family_memberships ===
create trigger _900_rt after insert or update or delete on app_public.family_memberships
  for each row execute procedure app_public.tg__graphql_subscription(
    'familyMembershipChanged', 'rt:family_memberships', 'user_id'
  );

-- === lesson_notes ===
create trigger _900_rt after insert or update or delete on app_public.lesson_notes
  for each row execute procedure app_public.tg__graphql_subscription(
    'lessonNoteChanged', 'rt:lesson_notes', 'lesson_id'
  );

-- === practice_logs ===
create trigger _900_rt after insert or update or delete on app_public.practice_logs
  for each row execute procedure app_public.tg__graphql_subscription(
    'practiceLogChanged', 'rt:practice_logs', 'student_id'
  );

-- === assignment_notes ===
create trigger _900_rt after insert or update or delete on app_public.assignment_notes
  for each row execute procedure app_public.tg__graphql_subscription(
    'assignmentNoteChanged', 'rt:assignment_notes', 'student_id'
  );

-- === lesson_deposits ===
create trigger _900_rt after insert or update or delete on app_public.lesson_deposits
  for each row execute procedure app_public.tg__graphql_subscription(
    'lessonDepositChanged', 'rt:lesson_deposits', 'lesson_id'
  );

--! split: 0314-testimonials.sql
create table app_public.testimonials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default app_public.current_user_id() references app_public.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 20 and 2000),
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_testimonials_updated_at on app_public.testimonials (updated_at desc);

create trigger _timestamps
  before insert or update on app_public.testimonials
  for each row execute function app_private.tg__timestamps();

create function app_private.tg__reset_testimonial_approval() returns trigger as $$
begin
  if TG_OP = 'UPDATE' and NEW.body is distinct from OLD.body then
    NEW.is_approved = false;
  end if;

  return NEW;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

create trigger _reset_approval
  before update on app_public.testimonials
  for each row execute function app_private.tg__reset_testimonial_approval();

alter table app_public.testimonials enable row level security;

create policy select_approved_or_own on app_public.testimonials for select
  using (
    is_approved = true
    or user_id = app_public.current_user_id()
    or app_public.current_user_role() in ('admin', 'teacher')
  );

create policy insert_own_non_admin on app_public.testimonials for insert
  with check (
    user_id = app_public.current_user_id()
    and app_public.current_user_role() <> 'admin'
  );

create policy update_own_non_admin on app_public.testimonials for update
  using (
    user_id = app_public.current_user_id()
    and app_public.current_user_role() <> 'admin'
  )
  with check (
    user_id = app_public.current_user_id()
    and app_public.current_user_role() <> 'admin'
  );

create policy delete_own_non_admin on app_public.testimonials for delete
  using (
    user_id = app_public.current_user_id()
    and app_public.current_user_role() <> 'admin'
  );

create policy update_admin_approval on app_public.testimonials for update
  using (app_public.current_user_role() = 'admin');

grant select on app_public.testimonials to :DATABASE_VISITOR;
grant insert (body) on app_public.testimonials to :DATABASE_VISITOR;
grant update (body, is_approved) on app_public.testimonials to :DATABASE_VISITOR;
grant delete on app_public.testimonials to :DATABASE_VISITOR;

comment on table app_public.testimonials is 'Public testimonials written by non-admin users. One testimonial per user.';
comment on column app_public.testimonials.body is 'A public testimonial shown on the marketing site.';
comment on column app_public.testimonials.is_approved is 'Whether the testimonial is approved for public display.';

--! split: 0315-testimonial-reminders.sql
alter table app_private.user_secrets
  add column if not exists testimonial_prompt_enabled boolean not null default false,
  add column if not exists testimonial_next_prompt_at timestamptz,
  add column if not exists testimonial_last_emailed_at timestamptz;

comment on column app_private.user_secrets.testimonial_prompt_enabled is
  'Whether the dashboard testimonial prompt should currently be shown to this user.';
comment on column app_private.user_secrets.testimonial_next_prompt_at is
  'When this user should next be prompted and emailed for a testimonial reminder.';
comment on column app_private.user_secrets.testimonial_last_emailed_at is
  'When the last testimonial reminder email was queued for this user.';

create index if not exists idx_user_secrets_testimonial_next_prompt_at
  on app_private.user_secrets (testimonial_next_prompt_at)
  where testimonial_next_prompt_at is not null;

create or replace function app_private.testimonial_reminder_interval_days()
returns integer as $$
declare
  v_value jsonb;
  v_days integer;
begin
  select value
    into v_value
    from app_private.admin_settings
    where key = 'testimonial_reminder_interval_days';

  if jsonb_typeof(v_value) = 'number' then
    v_days := (v_value #>> '{}')::integer;
  end if;

  if v_days is null or v_days < 1 or v_days > 365 then
    return 30;
  end if;

  return v_days;
end;
$$ language plpgsql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_private.testimonial_reminder_interval_days() is
  'Returns the configured testimonial reminder interval in days, defaulting to 30.';

create or replace function app_private.tg_user_secrets__insert_with_user() returns trigger as $$
begin
  insert into app_private.user_secrets(user_id, testimonial_next_prompt_at)
  values(
    NEW.id,
    case
      when NEW.role in ('student', 'parent') then
        NEW.created_at + make_interval(days => app_private.testimonial_reminder_interval_days())
      else null
    end
  );
  return NEW;
end;
$$ language plpgsql volatile set search_path to pg_catalog, public, pg_temp;

update app_private.user_secrets as secrets
set testimonial_prompt_enabled = false,
    testimonial_next_prompt_at = case
      when users.role in ('student', 'parent')
        and not exists (
          select 1
          from app_public.testimonials
          where testimonials.user_id = users.id
        )
      then now() + make_interval(days => app_private.testimonial_reminder_interval_days())
      else null
    end
from app_public.users as users
where users.id = secrets.user_id
  and secrets.testimonial_next_prompt_at is null;

--! split: 0316-assignment-progress.sql
create table app_public.assignment_progress (
  student_id uuid not null,
  material_id uuid not null,
  listened_seconds integer not null default 0 check (listened_seconds >= 0),
  last_played_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (student_id, material_id),
  foreign key (student_id, material_id)
    references app_public.student_materials(student_id, material_id)
    on delete cascade
);

create index assignment_progress_student_updated_at
  on app_public.assignment_progress(student_id, updated_at desc);

alter table app_public.assignment_progress enable row level security;

create policy select_own on app_public.assignment_progress for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_own on app_public.assignment_progress for insert
  with check (student_id = app_public.current_user_id());

create policy update_own on app_public.assignment_progress for update
  using (student_id = app_public.current_user_id());

create policy insert_admin on app_public.assignment_progress for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.assignment_progress for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.assignment_progress for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update, delete on app_public.assignment_progress to :DATABASE_VISITOR;
grant insert (student_id, material_id, listened_seconds, last_played_at, updated_at)
  on app_public.assignment_progress to :DATABASE_VISITOR;
grant update (listened_seconds, last_played_at, updated_at)
  on app_public.assignment_progress to :DATABASE_VISITOR;

comment on table app_public.assignment_progress is
  'Per-student cumulative playback progress for directly assigned materials.';
comment on column app_public.assignment_progress.listened_seconds is
  'Cumulative time in whole seconds that notation playback has actively run for this assignment.';

create table app_public.assignment_reviews (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  material_id uuid not null,
  stars smallint not null check (stars between 1 and 5),
  listened_seconds integer not null default 0 check (listened_seconds >= 0),
  created_at timestamptz not null default now(),
  foreign key (student_id, material_id)
    references app_public.student_materials(student_id, material_id)
    on delete cascade
);

create index assignment_reviews_student_material_created_at
  on app_public.assignment_reviews(student_id, material_id, created_at desc);

alter table app_public.assignment_reviews enable row level security;

create policy select_own on app_public.assignment_reviews for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_own on app_public.assignment_reviews for insert
  with check (student_id = app_public.current_user_id());

create policy insert_admin on app_public.assignment_reviews for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert on app_public.assignment_reviews to :DATABASE_VISITOR;
grant insert (student_id, material_id, stars, listened_seconds)
  on app_public.assignment_reviews to :DATABASE_VISITOR;

comment on table app_public.assignment_reviews is
  'Historical 1-5 self-reviews recorded by students for assigned materials.';
comment on column app_public.assignment_reviews.listened_seconds is
  'The student''s cumulative listened seconds snapshot at the moment this review was recorded.';

--! split: 0318-assignment-progress-realtime.sql
create trigger _900_rt after insert or update or delete on app_public.assignment_progress
  for each row execute procedure app_public.tg__graphql_subscription(
    'assignmentProgressChanged', 'rt:assignment_progress', 'student_id'
  );

create trigger _900_rt after insert or update or delete on app_public.assignment_reviews
  for each row execute procedure app_public.tg__graphql_subscription(
    'assignmentReviewChanged', 'rt:assignment_reviews', 'student_id'
  );

--! split: 0320-assignment-notation-tracks.sql
alter table app_public.materials
  add column notation_tracks jsonb;

comment on column app_public.materials.notation_tracks is 'Detected AlphaTab track metadata for notation materials.';

alter table app_public.student_materials
  add column assigned_track_index integer,
  add constraint student_materials_assigned_track_index_nonnegative
    check (assigned_track_index is null or assigned_track_index >= 0);

comment on column app_public.student_materials.assigned_track_index is 'Optional AlphaTab track index chosen for this student assignment.';

--! split: 0322-testimonial-reminder-sweep-cron.sql
delete from graphile_worker._private_jobs as jobs
using graphile_worker._private_tasks as tasks
where tasks.id = jobs.task_id
  and tasks.identifier = 'testimonials__reminder_sweep'
  and jobs.locked_at is null;

--! split: 0324-material-storage.sql
alter table app_public.materials
  rename column file_path to storage_key;

alter table app_public.materials
  add column storage_backend text not null default 'local',
  add column content_hash text;

comment on column app_public.materials.storage_backend is 'Storage backend identifier for uploaded material blobs.';
comment on column app_public.materials.storage_key is 'Backend-specific blob key used to locate uploaded material bytes.';
comment on column app_public.materials.content_hash is 'SHA-256 hash of uploaded material bytes used for deduplication.';

create unique index materials_content_hash_key
  on app_public.materials (content_hash)
  where content_hash is not null;

--! split: 0325-active-student-session.sql
/*
 * Adds active_student_id to sessions so parent accounts can
 * remember which child they are currently acting on behalf of.
 * Null means "acting as self" or not applicable (admin/teacher/student).
 */

alter table app_private.sessions
  add column active_student_id uuid references app_public.users on delete set null;

comment on column app_private.sessions.active_student_id is
  E'When a parent selects a student from their family, this points to that student''s user ID. NULL means acting as self (or not a parent).';

--! split: 0326-effective-student-rls.sql
/*
 * Effective student resolution for parent accounts.
 *
 * When a parent session has active_student_id set, the parent acts
 * on behalf of that student. current_effective_user_id() returns the
 * student's ID in that case, or the session user's ID otherwise.
 *
 * Writes (practice_logs, assignment_progress, assignment_reviews,
 * assignment_notes, messages, lessons) are updated to allow parents
 * to act as their active student.
 */

create function app_public.current_effective_user_id() returns uuid as $$
  select coalesce(
    (select s.active_student_id
       from app_private.sessions s
       join app_public.users u on u.id = s.user_id
      where s.id = app_public.current_session_id()
        and u.role = 'parent'
        and s.active_student_id is not null
        and s.active_student_id in (select app_public.current_user_family_member_ids())),
    app_public.current_user_id()
  );
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.current_effective_user_id() is
  E'Returns the active student ID when the session user is a parent with an active student; falls back to the session user ID otherwise.';

-- extend the is-acting-for-family-student check to a reusable helper
create function app_public.is_acting_for_family_student(student_id uuid) returns boolean as $$
  select app_public.current_user_role() in ('admin', 'teacher')
      or student_id = app_public.current_effective_user_id();
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.is_acting_for_family_student(uuid) is
  E'Returns true when the caller (or their effective student) owns the given student_id.';

create function app_public.can_book_for_family_student(student_id uuid) returns boolean as $$
  select app_public.current_user_role() in ('admin', 'teacher')
      or student_id = app_public.current_user_id()
      or student_id in (select app_public.current_user_family_member_ids());
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.can_book_for_family_student(uuid) is
  E'Returns true when the caller may book a lesson for the given student, including parents booking for family students.';

-- ============================================================================
-- practice_logs: replace student-only insert with effective-student-aware
-- ============================================================================
drop policy if exists insert_own on app_public.practice_logs;

create policy insert_own on app_public.practice_logs for insert
  with check (app_public.is_acting_for_family_student(student_id));

drop policy if exists update_own on app_public.practice_logs;

create policy update_own on app_public.practice_logs for update
  using (app_public.is_acting_for_family_student(student_id));

-- ============================================================================
-- assignment_progress: insert/update now effective-student-aware
-- ============================================================================
drop policy if exists insert_own on app_public.assignment_progress;
drop policy if exists update_own on app_public.assignment_progress;

create policy insert_own on app_public.assignment_progress for insert
  with check (app_public.is_acting_for_family_student(student_id));

create policy update_own on app_public.assignment_progress for update
  using (app_public.is_acting_for_family_student(student_id));

-- ============================================================================
-- assignment_reviews: insert now effective-student-aware
-- ============================================================================
drop policy if exists insert_own on app_public.assignment_reviews;

create policy insert_own on app_public.assignment_reviews for insert
  with check (app_public.is_acting_for_family_student(student_id));

-- ============================================================================
-- assignment_notes: insert/update now effective-student-aware
-- ============================================================================
drop policy if exists insert_own on app_public.assignment_notes;
drop policy if exists update_own on app_public.assignment_notes;

create policy insert_own on app_public.assignment_notes for insert
  with check (app_public.is_acting_for_family_student(student_id));

create policy update_own on app_public.assignment_notes for update
  using (app_public.is_acting_for_family_student(student_id));

-- ============================================================================
-- messages: allow parent to send as effective student
-- ============================================================================
drop policy if exists insert_sender on app_public.messages;

create policy insert_sender on app_public.messages for insert
  with check (app_public.is_acting_for_family_student(sender_id));

-- ============================================================================
-- lessons: allow parents acting for a family student to book lessons
-- ============================================================================
drop policy if exists insert_family on app_public.lessons;

create policy insert_family on app_public.lessons for insert
  with check (app_public.can_book_for_family_student(student_id));

-- Also need insert grant for lessons (only select was granted initially)
grant insert on app_public.lessons to :DATABASE_VISITOR;

drop policy if exists insert_family on app_public.lesson_deposits;

create policy insert_family on app_public.lesson_deposits for insert
  with check (
    lesson_id in (
      select id from app_public.lessons
      where app_public.can_book_for_family_student(student_id)
    )
  );

--! split: 0327-parent-create-child.sql
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

  if v_user_secret.child_password_reset_token is null
     or v_user_secret.child_password_reset_token is distinct from token then
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

--! split: 0328-lesson-cancellation-policy.sql
create type app_public.billing_model as enum ('single_booking', 'monthly_prepaid');

alter table app_public.student_rates
  add column billing_model app_public.billing_model not null default 'single_booking';

alter table app_public.lessons
  add column cancellation_fee_cents integer not null default 0
    check (cancellation_fee_cents >= 0),
  add column remainder_due_cents integer not null default 0
    check (remainder_due_cents >= 0);

insert into app_private.admin_settings (key, value)
values
  ('cancellation_window_hours', '24'::jsonb),
  ('late_cancel_charge_percent', '50'::jsonb)
on conflict (key) do nothing;

drop policy if exists update_own_scheduled on app_public.lessons;
create policy update_own_scheduled on app_public.lessons for update
  using (
    status = 'scheduled'
    and app_public.is_acting_for_family_student(student_id)
  )
  with check (
    app_public.is_acting_for_family_student(student_id)
    and status in ('scheduled', 'cancelled')
  );

drop policy if exists update_own on app_public.lesson_deposits;
create policy update_own on app_public.lesson_deposits for update
  using (
    lesson_id in (
      select id from app_public.lessons
      where app_public.is_acting_for_family_student(student_id)
    )
  )
  with check (
    lesson_id in (
      select id from app_public.lessons
      where app_public.is_acting_for_family_student(student_id)
    )
  );

comment on column app_public.student_rates.billing_model is
  'How lessons at this rate are billed: per-booking deposit or monthly prepaid.';
comment on column app_public.lessons.cancellation_fee_cents is
  'Fee recorded when a monthly-prepaid lesson is cancelled inside the policy window.';
comment on column app_public.lessons.remainder_due_cents is
  'Amount still due after a completed single-booking lesson deposit is captured.';

--! split: 0329-recurring-schedules.sql
create table app_public.recurring_schedules (
  id uuid primary key default gen_random_uuid(),
  student_rate_id uuid not null
    references app_public.student_rates(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  local_start_time time without time zone not null,
  timezone text not null default 'America/Chicago',
  starts_on date not null,
  ends_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

create index recurring_schedules_student_rate
  on app_public.recurring_schedules(student_rate_id);
create index recurring_schedules_active_bounds
  on app_public.recurring_schedules(starts_on, ends_on)
  where active;

create trigger _timestamps
  before insert or update on app_public.recurring_schedules
  for each row execute function app_private.tg__timestamps();

create table app_public.monthly_payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  billing_month date not null
    check (billing_month = date_trunc('month', billing_month)::date),
  amount_cents integer not null check (amount_cents > 0),
  paid_at timestamptz not null default now(),
  notes text,
  generation_status text not null default 'pending'
    check (generation_status in ('pending', 'processing', 'generated', 'failed')),
  generation_error text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, billing_month)
);

create index monthly_payments_billing_month
  on app_public.monthly_payments(billing_month);

create trigger _timestamps
  before insert or update on app_public.monthly_payments
  for each row execute function app_private.tg__timestamps();

alter table app_public.lessons
  add column recurring_schedule_id uuid
    references app_public.recurring_schedules(id),
  add column recurrence_date date,
  add constraint lessons_recurrence_provenance_complete check (
    (recurring_schedule_id is null) = (recurrence_date is null)
  );

alter table app_public.lessons
  add constraint lessons_recurring_occurrence_unique
    unique (recurring_schedule_id, recurrence_date);

create index lessons_recurring_schedule
  on app_public.lessons(recurring_schedule_id)
  where recurring_schedule_id is not null;

alter table app_public.recurring_schedules enable row level security;

create policy select_own on app_public.recurring_schedules for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_rate_id in (
      select id
      from app_public.student_rates
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );

create policy insert_admin on app_public.recurring_schedules for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.recurring_schedules for update
  using (app_public.current_user_role() in ('admin', 'teacher'))
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.recurring_schedules for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update, delete on app_public.recurring_schedules to :DATABASE_VISITOR;

alter table app_public.monthly_payments enable row level security;

create policy select_own on app_public.monthly_payments for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_admin on app_public.monthly_payments for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.monthly_payments for update
  using (app_public.current_user_role() in ('admin', 'teacher'))
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.monthly_payments for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update, delete on app_public.monthly_payments to :DATABASE_VISITOR;

create function app_public.enqueue_prepaid_lesson_generation(payment_id uuid)
returns void as $$
begin
  if app_public.current_user_role() not in ('admin', 'teacher') then
    raise insufficient_privilege using message = 'Only admins and teachers may enqueue lesson generation';
  end if;

  perform graphile_worker.add_job(
    'lessons__generate_prepaid_period',
    json_build_object(
      'studentId', (select mp.student_id from app_public.monthly_payments mp where mp.id = payment_id),
      'billingMonth', (select to_char(mp.billing_month, 'YYYY-MM-DD') from app_public.monthly_payments mp where mp.id = payment_id)
    ),
    job_key := 'lessons__generate_prepaid_period:' || payment_id::text,
    job_key_mode := 'replace'
  );
end;
$$ language plpgsql volatile security definer
set search_path to pg_catalog, public, pg_temp;

grant execute on function app_public.enqueue_prepaid_lesson_generation(uuid)
  to :DATABASE_VISITOR;

comment on table app_public.recurring_schedules is
  'Standing weekly lesson slots. The referenced student rate supplies student, duration, and location.';
comment on column app_public.recurring_schedules.day_of_week is
  'ISO weekday, Monday = 1 through Sunday = 7.';
comment on column app_public.recurring_schedules.local_start_time is
  'Wall-clock lesson start time in the schedule timezone.';
comment on table app_public.monthly_payments is
  'Monthly prepaid payment records and their lesson-generation state.';
comment on column app_public.monthly_payments.billing_month is
  'First calendar day of the paid month.';
comment on column app_public.monthly_payments.amount_cents is
  'Amount received, in cents.';
comment on column app_public.lessons.recurring_schedule_id is
  'Standing schedule that generated this individual lesson occurrence.';
comment on column app_public.lessons.recurrence_date is
  'Local calendar date of this recurring lesson occurrence.';

--! split: 0330-billing-ledger.sql
-- Billing ledger: immutable family-owned financial records with student attribution.
-- Bills, line items, payments, allocations, credits, refunds, audit history.
-- Sequential document numbers, discount/tax snapshots, notification state.
-- No history backfill; existing monthly_payments and lesson_deposits remain
-- the source of truth for prepaid billing and deposit capture.

-- ============================================================================
-- Enums
-- ============================================================================

create type app_public.bill_status as enum (
  'draft',
  'issued',
  'paid',
  'cancelled',
  'void'
);

create type app_public.bill_line_type as enum (
  'lesson',
  'single_booking',
  'fee',
  'adjustment',
  'credit'
);

create type app_public.payment_method as enum (
  'cash',
  'check',
  'card',
  'bank_transfer',
  'other'
);

-- ============================================================================
-- Document number sequences (transactional, never-reused counters)
-- ============================================================================

create table app_public.bill_number_sequences (
  family_id uuid primary key references app_public.families(id) on delete cascade,
  last_number integer not null default 0
);

alter table app_public.bill_number_sequences enable row level security;

create table app_public.payment_number_sequences (
  family_id uuid primary key references app_public.families(id) on delete cascade,
  last_number integer not null default 0
);

alter table app_public.payment_number_sequences enable row level security;

create function app_public.next_bill_number(p_family_id uuid) returns integer as $$
declare
  v_next integer;
begin
  insert into app_public.bill_number_sequences (family_id, last_number)
    values (p_family_id, 0)
    on conflict (family_id) do nothing;

  update app_public.bill_number_sequences
    set last_number = last_number + 1
    where family_id = p_family_id
    returning last_number into v_next;
  return v_next;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

create function app_public.next_payment_number(p_family_id uuid) returns integer as $$
declare
  v_next integer;
begin
  insert into app_public.payment_number_sequences (family_id, last_number)
    values (p_family_id, 0)
    on conflict (family_id) do nothing;

  update app_public.payment_number_sequences
    set last_number = last_number + 1
    where family_id = p_family_id
    returning last_number into v_next;
  return v_next;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

-- ============================================================================
-- Bills
-- ============================================================================

create table app_public.bills (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families(id) on delete restrict,
  bill_number integer not null,
  status app_public.bill_status not null default 'draft',
  billing_period_start date not null,
  billing_period_end date not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  issued_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  voided_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, bill_number),
  check (billing_period_end >= billing_period_start),
  check (issued_at is null or issued_at >= created_at),
  check (paid_at is null or paid_at >= issued_at),
  check (cancelled_at is null or cancelled_at >= created_at),
  check (voided_at is null or voided_at >= created_at),
  check (
    (status = 'issued' and issued_at is not null)
    or (status = 'paid' and issued_at is not null and paid_at is not null)
    or (status = 'cancelled' and cancelled_at is not null)
    or (status = 'void' and voided_at is not null)
    or status = 'draft'
  )
);

alter table app_public.bills enable row level security;

create index bills_family_status on app_public.bills(family_id, status);
create index bills_billing_period on app_public.bills(billing_period_start, billing_period_end);

grant select, insert, update(status, paid_at, cancelled_at, voided_at, notes) on app_public.bills to :DATABASE_VISITOR;

create trigger _timestamps
  before insert or update on app_public.bills
  for each row execute function app_private.tg__timestamps();

comment on table app_public.bills is 'Family-owned bills with itemized charges. Immutable after issue: amounts fixed at snapshotted totals.';
comment on column app_public.bills.family_id is 'The family being billed.';
comment on column app_public.bills.bill_number is 'Sequential number within the family. Generated via next_bill_number(). Never reused.';
comment on column app_public.bills.status is 'Lifecycle: draft -> issued -> paid | cancelled | void.';
comment on column app_public.bills.billing_period_start is 'First calendar day of the billing period.';
comment on column app_public.bills.billing_period_end is 'Last calendar day of the billing period.';
comment on column app_public.bills.subtotal_cents is 'Sum of all line item amounts before discount and tax.';
comment on column app_public.bills.discount_cents is 'Discount amount snapshot at issue time.';
comment on column app_public.bills.tax_cents is 'Tax amount snapshot at issue time.';
comment on column app_public.bills.total_cents is 'subtotal_cents - discount_cents + tax_cents.';
comment on column app_public.bills.issued_at is 'When the bill was issued to the family.';
comment on column app_public.bills.paid_at is 'When the bill was fully paid.';
comment on column app_public.bills.cancelled_at is 'When the bill was cancelled (before payment).';
comment on column app_public.bills.voided_at is 'When the bill was voided (after payment, compensating entries exist).';
comment on column app_public.bills.notes is 'Internal notes about this bill.';

-- ============================================================================
-- Bill line items
-- ============================================================================

create table app_public.bill_line_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references app_public.bills(id) on delete cascade,
  student_id uuid not null references app_public.users(id) on delete restrict,
  line_type app_public.bill_line_type not null,
  description text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  lesson_id uuid references app_public.lessons(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table app_public.bill_line_items enable row level security;

create index bill_line_items_bill on app_public.bill_line_items(bill_id);
create index bill_line_items_student on app_public.bill_line_items(student_id);
create index bill_line_items_lesson on app_public.bill_line_items(lesson_id) where lesson_id is not null;

grant select, insert on app_public.bill_line_items to :DATABASE_VISITOR;

comment on table app_public.bill_line_items is 'Itemized charges on a bill, each attributed to a student. Immutable after bill issuance.';
comment on column app_public.bill_line_items.bill_id is 'Parent bill.';
comment on column app_public.bill_line_items.student_id is 'Student who incurred this charge.';
comment on column app_public.bill_line_items.line_type is 'Category of charge: lesson, single_booking, fee, adjustment, credit.';
comment on column app_public.bill_line_items.description is 'Human-readable description of the charge.';
comment on column app_public.bill_line_items.quantity is 'Number of units (e.g. number of lessons at this rate).';
comment on column app_public.bill_line_items.unit_price_cents is 'Price per unit in cents.';
comment on column app_public.bill_line_items.amount_cents is 'Total line amount = quantity * unit_price_cents.';
comment on column app_public.bill_line_items.lesson_id is 'Optional reference to a specific lesson that generated this charge.';

-- ============================================================================
-- Payments
-- ============================================================================

create table app_public.payments (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families(id) on delete restrict,
  payment_number integer not null,
  amount_cents integer not null check (amount_cents > 0),
  method app_public.payment_method not null,
  reference text,
  received_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, payment_number)
);

alter table app_public.payments enable row level security;

create index payments_family on app_public.payments(family_id);
create index payments_received on app_public.payments(received_at desc);

grant select, insert, update(method, reference, received_at, notes) on app_public.payments to :DATABASE_VISITOR;

create trigger _timestamps
  before insert or update on app_public.payments
  for each row execute function app_private.tg__timestamps();

comment on table app_public.payments is 'Payments received from a family. Immutable after creation; refunds are separate compensating entries.';
comment on column app_public.payments.family_id is 'The family that made the payment.';
comment on column app_public.payments.payment_number is 'Sequential number within the family. Generated via next_payment_number(). Never reused.';
comment on column app_public.payments.amount_cents is 'Payment amount in cents.';
comment on column app_public.payments.method is 'How the payment was made.';
comment on column app_public.payments.reference is 'External reference (check number, transaction ID, etc.).';
comment on column app_public.payments.received_at is 'When the payment was received.';

-- ============================================================================
-- Payment allocations
-- ============================================================================

create table app_public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references app_public.payments(id) on delete cascade,
  bill_id uuid not null references app_public.bills(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, bill_id)
);

alter table app_public.payment_allocations enable row level security;

create index payment_allocations_payment on app_public.payment_allocations(payment_id);
create index payment_allocations_bill on app_public.payment_allocations(bill_id);

grant select, insert on app_public.payment_allocations to :DATABASE_VISITOR;

comment on table app_public.payment_allocations is 'Maps payments to the bills they cover. A payment may be split across multiple bills.';
comment on column app_public.payment_allocations.payment_id is 'The payment being allocated.';
comment on column app_public.payment_allocations.bill_id is 'The bill being paid.';
comment on column app_public.payment_allocations.amount_cents is 'Amount from this payment applied to this bill.';

-- ============================================================================
-- Family credits
-- ============================================================================

create table app_public.family_credits (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families(id) on delete restrict,
  student_id uuid references app_public.users(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  reason text not null,
  created_by uuid not null references app_public.users(id) on delete restrict,
  expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (consumed_at is null or consumed_at >= created_at),
  check (expires_at is null or expires_at >= created_at)
);

alter table app_public.family_credits enable row level security;

create index family_credits_family on app_public.family_credits(family_id);
create index family_credits_unconsumed on app_public.family_credits(family_id)
  where consumed_at is null;

grant select, insert, update(consumed_at) on app_public.family_credits to :DATABASE_VISITOR;

comment on table app_public.family_credits is 'Positive credit balance on a family account. Drawn down when applied to a bill.';
comment on column app_public.family_credits.student_id is 'Optional student attribution for the credit.';
comment on column app_public.family_credits.amount_cents is 'Credit amount in cents. Always positive; credits reduce bill totals.';
comment on column app_public.family_credits.reason is 'Why the credit was issued (referral, promotion, compensation, etc.).';
comment on column app_public.family_credits.created_by is 'Admin user who issued the credit.';
comment on column app_public.family_credits.expires_at is 'Optional expiry date for the credit.';
comment on column app_public.family_credits.consumed_at is 'When the credit was fully consumed.';

-- ============================================================================
-- Refunds
-- ============================================================================

create table app_public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references app_public.payments(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  reason text not null,
  created_by uuid not null references app_public.users(id) on delete restrict,
  refunded_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  check (refunded_at >= created_at)
);

alter table app_public.refunds enable row level security;

create index refunds_payment on app_public.refunds(payment_id);

grant select, insert on app_public.refunds to :DATABASE_VISITOR;

comment on table app_public.refunds is 'Refunds/reversals of payments. Immutable: a refund is a compensating entry, not a payment modification.';
comment on column app_public.refunds.payment_id is 'The original payment being refunded.';
comment on column app_public.refunds.amount_cents is 'Refund amount in cents. Must not exceed the unrefunded portion of the payment.';
comment on column app_public.refunds.reason is 'Why the refund was issued.';
comment on column app_public.refunds.created_by is 'Admin user who processed the refund.';
comment on column app_public.refunds.refunded_at is 'When the refund was issued.';

-- ============================================================================
-- Bill notifications (delivery state)
-- ============================================================================

create table app_public.bill_notifications (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references app_public.bills(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'portal')),
  sent_at timestamptz not null default now(),
  status text not null default 'sent' check (status in ('sent', 'delivered', 'failed')),
  error text,
  unique (bill_id, channel)
);

alter table app_public.bill_notifications enable row level security;

create index bill_notifications_bill on app_public.bill_notifications(bill_id);

grant select, insert, update(status, error) on app_public.bill_notifications to :DATABASE_VISITOR;

comment on table app_public.bill_notifications is 'Tracks delivery state of bill notifications across channels.';
comment on column app_public.bill_notifications.channel is 'Delivery channel: email, sms, or portal.';
comment on column app_public.bill_notifications.status is 'Delivery status: sent, delivered, or failed.';

-- ============================================================================
-- Financial audit events
-- ============================================================================

create table app_public.financial_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references app_public.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id uuid not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

alter table app_public.financial_audit_events enable row level security;

create index financial_audit_events_table_record
  on app_public.financial_audit_events(table_name, record_id);
create index financial_audit_events_actor
  on app_public.financial_audit_events(actor_id);
create index financial_audit_events_created
  on app_public.financial_audit_events(created_at desc);

grant select on app_public.financial_audit_events to :DATABASE_VISITOR;

comment on table app_public.financial_audit_events is 'Append-only audit log for financial record changes.';
comment on column app_public.financial_audit_events.actor_id is 'User who performed the action. Null for system-generated events.';
comment on column app_public.financial_audit_events.action is 'The operation performed (create, update, issue, cancel, void, refund, etc.).';
comment on column app_public.financial_audit_events.table_name is 'The table that was modified.';
comment on column app_public.financial_audit_events.record_id is 'The primary key of the modified record.';
comment on column app_public.financial_audit_events.old_values is 'Previous state of the record (null for creates).';
comment on column app_public.financial_audit_events.new_values is 'New state of the record (null for deletes).';

-- ============================================================================
-- RLS policies
-- ============================================================================

-- Helper: returns true if the current user is a billing contact for the family
create function app_public.current_user_is_billing_contact_for(p_family_id uuid) returns boolean as $$
  select exists(
    select 1 from app_public.family_memberships
    where family_id = p_family_id
      and user_id = app_public.current_user_id()
      and is_billing_contact = true
  );
$$ language sql stable security definer set search_path to pg_catalog;

-- bills: family billing contact, family members (read-only), admin/teacher
create policy select_bills on app_public.bills for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_bills on app_public.bills for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy update_bills on app_public.bills for update
  using (app_public.current_user_role() in ('admin', 'teacher'))
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy delete_bills on app_public.bills for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

-- bill_line_items: same scope as bills (via bill join)
create policy select_bill_line_items on app_public.bill_line_items for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_bill_line_items on app_public.bill_line_items for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy delete_bill_line_items on app_public.bill_line_items for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

-- payments: family billing contact, admin/teacher
create policy select_payments on app_public.payments for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_payments on app_public.payments for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy update_payments on app_public.payments for update
  using (app_public.current_user_role() in ('admin', 'teacher'))
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy delete_payments on app_public.payments for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

-- payment_allocations: same scope as payments/bills
create policy select_payment_allocations on app_public.payment_allocations for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
    or payment_id in (
      select id from app_public.payments
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_payment_allocations on app_public.payment_allocations for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy delete_payment_allocations on app_public.payment_allocations for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

-- family_credits: family can see own, admin/teacher manage
create policy select_family_credits on app_public.family_credits for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_family_credits on app_public.family_credits for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy update_family_credits on app_public.family_credits for update
  using (app_public.current_user_role() in ('admin', 'teacher'))
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy delete_family_credits on app_public.family_credits for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

-- refunds: family can see own, admin/teacher manage
create policy select_refunds on app_public.refunds for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or payment_id in (
      select id from app_public.payments
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_refunds on app_public.refunds for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

-- bill_notifications: family can read, system inserts/updates
create policy select_bill_notifications on app_public.bill_notifications for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_bill_notifications on app_public.bill_notifications for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy update_bill_notifications on app_public.bill_notifications for update
  using (app_public.current_user_role() in ('admin', 'teacher'))
  with check (app_public.current_user_role() in ('admin', 'teacher'));

-- financial_audit_events: admin/teacher only
create policy select_financial_audit_events on app_public.financial_audit_events for select
  using (app_public.current_user_role() in ('admin', 'teacher'));

create policy insert_financial_audit_events on app_public.financial_audit_events for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

--! split: 0331-billing-ledger-foundation.sql
-- Foundation repair for billing ledger: admin-only financial access,
-- due_date, discount/tax configuration with dated history, tax exemption,
-- credit application tracking, bill adjustments, immutable-after-issue
-- enforcement, corrected RLS (teachers must not access billing).

-- ============================================================================
-- 1. Add due_date to bills
-- ============================================================================

alter table app_public.bills
  add column due_date date;

comment on column app_public.bills.due_date is 'Date by which the bill should be paid. Nullable for flexibility.';

-- ============================================================================
-- 2. Family discount configuration (dated/effective history)
-- ============================================================================

create table app_public.family_discounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families(id) on delete cascade,
  label text not null,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value integer not null check (discount_value > 0),
  applies_to text not null default 'all' check (applies_to in ('all', 'tuition', 'fees')),
  effective_from date not null,
  effective_until date,
  is_active boolean not null default true,
  created_by uuid not null references app_public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from),
  check (discount_type != 'percentage' or discount_value <= 100)
);

alter table app_public.family_discounts enable row level security;

create index family_discounts_family_active
  on app_public.family_discounts(family_id, is_active)
  where is_active = true;

create trigger _timestamps
  before insert or update on app_public.family_discounts
  for each row execute function app_private.tg__timestamps();

grant select on app_public.family_discounts to :DATABASE_VISITOR;
grant insert, update, delete on app_public.family_discounts to :DATABASE_VISITOR;

comment on table app_public.family_discounts is 'Family-specific discount configuration with dated effective periods. Snapshotted at bill issue time.';
comment on column app_public.family_discounts.discount_type is 'percentage or fixed amount in cents.';
comment on column app_public.family_discounts.discount_value is 'If percentage: percent (1-100). If fixed: cents.';
comment on column app_public.family_discounts.effective_from is 'First date this discount applies.';
comment on column app_public.family_discounts.effective_until is 'Last date this discount applies. Null = ongoing.';

-- ============================================================================
-- 3. Tax rate configuration
-- ============================================================================

create table app_public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  jurisdiction text not null,
  rate_percent integer not null check (rate_percent >= 0 and rate_percent <= 100),
  applies_to text not null default 'all' check (applies_to in ('all', 'tuition', 'fees')),
  effective_from date not null,
  effective_until date,
  is_active boolean not null default true,
  created_by uuid not null references app_public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from)
);

alter table app_public.tax_rates enable row level security;

create index tax_rates_active
  on app_public.tax_rates(is_active)
  where is_active = true;

create trigger _timestamps
  before insert or update on app_public.tax_rates
  for each row execute function app_private.tg__timestamps();

grant select on app_public.tax_rates to :DATABASE_VISITOR;
grant insert, update, delete on app_public.tax_rates to :DATABASE_VISITOR;

comment on table app_public.tax_rates is 'Tax rate definitions with jurisdictional and effective dating. Snapshotted at bill issue time.';

-- ============================================================================
-- 4. Family tax exemptions
-- ============================================================================

create table app_public.family_tax_exemptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families(id) on delete cascade,
  tax_rate_id uuid not null references app_public.tax_rates(id) on delete restrict,
  exemption_reason text not null,
  effective_from date not null,
  effective_until date,
  created_by uuid not null references app_public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (family_id, tax_rate_id)
);

alter table app_public.family_tax_exemptions enable row level security;

create index family_tax_exemptions_family
  on app_public.family_tax_exemptions(family_id);

grant select on app_public.family_tax_exemptions to :DATABASE_VISITOR;
grant insert, update, delete on app_public.family_tax_exemptions to :DATABASE_VISITOR;

comment on table app_public.family_tax_exemptions is 'Per-family exemptions from specific tax rates.';

-- ============================================================================
-- 5. Credit application tracking (which bills consumed which credits)
-- ============================================================================

create table app_public.family_credit_applications (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references app_public.family_credits(id) on delete restrict,
  bill_id uuid not null references app_public.bills(id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (credit_id, bill_id)
);

alter table app_public.family_credit_applications enable row level security;

create index fca_credit on app_public.family_credit_applications(credit_id);
create index fca_bill on app_public.family_credit_applications(bill_id);

grant select on app_public.family_credit_applications to :DATABASE_VISITOR;
grant insert on app_public.family_credit_applications to :DATABASE_VISITOR;

comment on table app_public.family_credit_applications is 'Tracks which credits were applied to which bills. Enforces 1:M credit-to-bill relationships.';

-- ============================================================================
-- 6. Bill adjustments (manual adjustments to issued bills)
-- ============================================================================

create table app_public.bill_adjustments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references app_public.bills(id) on delete restrict,
  amount_cents integer not null check (amount_cents <> 0),
  reason text not null,
  created_by uuid not null references app_public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table app_public.bill_adjustments enable row level security;

create index bill_adjustments_bill on app_public.bill_adjustments(bill_id);

grant select on app_public.bill_adjustments to :DATABASE_VISITOR;
grant insert on app_public.bill_adjustments to :DATABASE_VISITOR;

comment on table app_public.bill_adjustments is 'Manual adjustments to a bill after issue. Positive = additional charge, negative = reduction. Immutable once created.';

-- ============================================================================
-- 7. Refund reversal tracking
-- ============================================================================

alter table app_public.refunds
  add column reversed_at timestamptz,
  add column reversed_by uuid references app_public.users(id) on delete set null,
  add column reversal_reason text;

comment on column app_public.refunds.reversed_at is 'When this refund was reversed (if applicable).';
comment on column app_public.refunds.reversed_by is 'Admin who reversed the refund.';
comment on column app_public.refunds.reversal_reason is 'Why the refund was reversed.';

-- ============================================================================
-- 8. Payment immutability constraint
-- ============================================================================

-- Issuing a bill records issued_at in addition to its lifecycle status. The
-- original column grant omitted that timestamp, causing the update to fail
-- before the RLS policy could authorize it.
grant update(status, issued_at, paid_at, cancelled_at, voided_at, notes)
  on app_public.bills to :DATABASE_VISITOR;

alter table app_public.payments
  add constraint payments_immutable_amount_method
    check (amount_cents > 0 and method is not null);

create function app_private.tg_bills__immutable_after_issue() returns trigger as $$
begin
  if OLD.status <> 'draft' and (
    NEW.family_id is distinct from OLD.family_id
    or NEW.bill_number is distinct from OLD.bill_number
    or NEW.billing_period_start is distinct from OLD.billing_period_start
    or NEW.billing_period_end is distinct from OLD.billing_period_end
    or NEW.due_date is distinct from OLD.due_date
    or NEW.subtotal_cents is distinct from OLD.subtotal_cents
    or NEW.discount_cents is distinct from OLD.discount_cents
    or NEW.tax_cents is distinct from OLD.tax_cents
    or NEW.total_cents is distinct from OLD.total_cents
  ) then
    raise exception 'Issued bill amounts and identity are immutable';
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger _billing_immutable_after_issue
  before update on app_public.bills
  for each row execute function app_private.tg_bills__immutable_after_issue();

create function app_private.tg_payments__immutable() returns trigger as $$
begin
  raise exception 'Payments are immutable; record a reversal instead';
end;
$$ language plpgsql;

create trigger _billing_payments_immutable
  before update or delete on app_public.payments
  for each row execute function app_private.tg_payments__immutable();

-- ============================================================================
-- 9. RLS: Admin-only financial access (remove teachers)
-- ============================================================================

-- Drop old policies
drop policy if exists select_bills on app_public.bills;
drop policy if exists insert_bills on app_public.bills;
drop policy if exists update_bills on app_public.bills;
drop policy if exists delete_bills on app_public.bills;

drop policy if exists select_bill_line_items on app_public.bill_line_items;
drop policy if exists insert_bill_line_items on app_public.bill_line_items;
drop policy if exists delete_bill_line_items on app_public.bill_line_items;

drop policy if exists select_payments on app_public.payments;
drop policy if exists insert_payments on app_public.payments;
drop policy if exists update_payments on app_public.payments;
drop policy if exists delete_payments on app_public.payments;

drop policy if exists select_payment_allocations on app_public.payment_allocations;
drop policy if exists insert_payment_allocations on app_public.payment_allocations;
drop policy if exists delete_payment_allocations on app_public.payment_allocations;

drop policy if exists select_family_credits on app_public.family_credits;
drop policy if exists insert_family_credits on app_public.family_credits;
drop policy if exists update_family_credits on app_public.family_credits;
drop policy if exists delete_family_credits on app_public.family_credits;

drop policy if exists select_refunds on app_public.refunds;
drop policy if exists insert_refunds on app_public.refunds;

drop policy if exists select_bill_notifications on app_public.bill_notifications;
drop policy if exists insert_bill_notifications on app_public.bill_notifications;
drop policy if exists update_bill_notifications on app_public.bill_notifications;

drop policy if exists select_financial_audit_events on app_public.financial_audit_events;
drop policy if exists insert_financial_audit_events on app_public.financial_audit_events;

-- Recreate with admin-only access (teachers excluded)

-- bills: admin-only management, family members read-only
create policy select_bills on app_public.bills for select
  using (
    app_public.current_user_role() = 'admin'
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_bills on app_public.bills for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_bills on app_public.bills for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_bills on app_public.bills for delete
  using (app_public.current_user_role() = 'admin');

-- bill_line_items
create policy select_bill_line_items on app_public.bill_line_items for select
  using (
    app_public.current_user_role() = 'admin'
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_bill_line_items on app_public.bill_line_items for insert
  with check (app_public.current_user_role() = 'admin');

create policy delete_bill_line_items on app_public.bill_line_items for delete
  using (app_public.current_user_role() = 'admin');

-- payments
create policy select_payments on app_public.payments for select
  using (
    app_public.current_user_role() = 'admin'
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_payments on app_public.payments for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_payments on app_public.payments for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_payments on app_public.payments for delete
  using (app_public.current_user_role() = 'admin');

-- payment_allocations
create policy select_payment_allocations on app_public.payment_allocations for select
  using (
    app_public.current_user_role() = 'admin'
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
    or payment_id in (
      select id from app_public.payments
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_payment_allocations on app_public.payment_allocations for insert
  with check (app_public.current_user_role() = 'admin');

create policy delete_payment_allocations on app_public.payment_allocations for delete
  using (app_public.current_user_role() = 'admin');

-- family_credits
create policy select_family_credits on app_public.family_credits for select
  using (
    app_public.current_user_role() = 'admin'
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_family_credits on app_public.family_credits for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_family_credits on app_public.family_credits for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_family_credits on app_public.family_credits for delete
  using (app_public.current_user_role() = 'admin');

-- refunds
create policy select_refunds on app_public.refunds for select
  using (
    app_public.current_user_role() = 'admin'
    or payment_id in (
      select id from app_public.payments
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_refunds on app_public.refunds for insert
  with check (app_public.current_user_role() = 'admin');

-- bill_notifications
create policy select_bill_notifications on app_public.bill_notifications for select
  using (
    app_public.current_user_role() = 'admin'
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_bill_notifications on app_public.bill_notifications for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_bill_notifications on app_public.bill_notifications for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

-- financial_audit_events: admin-only (not even teachers)
create policy select_financial_audit_events on app_public.financial_audit_events for select
  using (app_public.current_user_role() = 'admin');

create policy insert_financial_audit_events on app_public.financial_audit_events for insert
  with check (app_public.current_user_role() = 'admin');

-- RLS for new tables

create policy select_family_discounts on app_public.family_discounts for select
  using (
    app_public.current_user_role() = 'admin'
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_family_discounts on app_public.family_discounts for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_family_discounts on app_public.family_discounts for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_family_discounts on app_public.family_discounts for delete
  using (app_public.current_user_role() = 'admin');

create policy select_tax_rates on app_public.tax_rates for select
  using (app_public.current_user_role() in ('admin', 'teacher'));

create policy insert_tax_rates on app_public.tax_rates for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_tax_rates on app_public.tax_rates for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_tax_rates on app_public.tax_rates for delete
  using (app_public.current_user_role() = 'admin');

create policy select_family_tax_exemptions on app_public.family_tax_exemptions for select
  using (
    app_public.current_user_role() = 'admin'
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_family_tax_exemptions on app_public.family_tax_exemptions for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_family_tax_exemptions on app_public.family_tax_exemptions for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_family_tax_exemptions on app_public.family_tax_exemptions for delete
  using (app_public.current_user_role() = 'admin');

create policy select_family_credit_applications on app_public.family_credit_applications for select
  using (
    app_public.current_user_role() = 'admin'
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_family_credit_applications on app_public.family_credit_applications for insert
  with check (app_public.current_user_role() = 'admin');

create policy select_bill_adjustments on app_public.bill_adjustments for select
  using (
    app_public.current_user_role() = 'admin'
    or bill_id in (
      select id from app_public.bills
      where family_id in (select app_public.current_user_member_family_ids())
    )
  );

create policy insert_bill_adjustments on app_public.bill_adjustments for insert
  with check (app_public.current_user_role() = 'admin');

--! split: 0332-tax-rate-precision.sql
-- Tax rate precision: support two decimal places, range 0.00-30.00
alter table app_public.tax_rates
  alter column rate_percent type numeric(5,2),
  drop constraint if exists tax_rates_rate_percent_check,
  add constraint tax_rates_rate_percent_check
    check (rate_percent >= 0.00 and rate_percent <= 30.00);

comment on column app_public.tax_rates.rate_percent is 'Tax rate as a percentage with two decimal precision (e.g., 8.25 = 8.25%). Range 0.00-30.00.';

--! split: 0333-billing-automation.sql
-- Billing automation: idempotent monthly bill issuance worker support.
-- All mutation logic in SECURITY DEFINER functions so the worker calls one
-- entry point. REVOKEd from DATABASE_VISITOR — only DB owner (worker) may
-- issue bills. Helper queries (eligible, occurrence_count, effective rates)
-- remain callable for admin inspection.
--
-- Bill granularity: one monthly bill per student, not one per family.
-- Idempotency keyed by (student_id, billing_month).
-- Due date: 5th of the billing month (same month as billing_period_start).
-- Rounding: explicit half-up via ROUND(), not integer truncation.

-- Safe re-runnable setup: CREATE OR REPLACE / IF NOT EXISTS for objects.
-- No DROP TABLE — would destroy billing run data.

-- ============================================================================
-- 1. Monthly billing runs tracking table
-- ============================================================================
-- One row per student per billing month for idempotency. The family_id is
-- denormalized for efficient per-family queries (reports, admin views).

create table if not exists app_public.monthly_billing_runs (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references app_public.families(id) on delete cascade,
  student_id uuid not null references app_public.users(id) on delete cascade,
  billing_month date not null
    check (billing_month = date_trunc('month', billing_month)::date),
  bill_id uuid references app_public.bills(id) on delete set null,
  due_date date not null,
  status text not null default 'completed'
    check (status in ('completed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (student_id, billing_month)
);

alter table app_public.monthly_billing_runs enable row level security;

create index monthly_billing_runs_family
  on app_public.monthly_billing_runs(family_id);
create index monthly_billing_runs_student
  on app_public.monthly_billing_runs(student_id);
create index monthly_billing_runs_month
  on app_public.monthly_billing_runs(billing_month);

grant select, insert, update(status, error)
  on app_public.monthly_billing_runs to :DATABASE_VISITOR;

comment on table app_public.monthly_billing_runs
  is 'Idempotency tracking for automated monthly bill issuance. One row per student per billing month.';
comment on column app_public.monthly_billing_runs.student_id
  is 'The student being billed. A family with multiple students gets one run per student.';
comment on column app_public.monthly_billing_runs.family_id
  is 'Denormalized family for efficient per-family aggregation in reports.';
comment on column app_public.monthly_billing_runs.bill_id
  is 'The issued bill. Null if billing failed before bill creation.';
comment on column app_public.monthly_billing_runs.due_date
  is 'Snapshotted due date; always the 5th of the billing month.';
comment on column app_public.monthly_billing_runs.status
  is 'completed or failed. Only completed rows prevent re-billing.';

-- ============================================================================
-- 2. RLS policies for monthly_billing_runs
-- ============================================================================

create policy select_monthly_billing_runs
  on app_public.monthly_billing_runs for select
  using (
    app_public.current_user_role() = 'admin'
    or family_id in (select app_public.current_user_member_family_ids())
  );

create policy insert_monthly_billing_runs
  on app_public.monthly_billing_runs for insert
  with check (app_public.current_user_role() = 'admin');

create policy update_monthly_billing_runs
  on app_public.monthly_billing_runs for update
  using (app_public.current_user_role() = 'admin')
  with check (app_public.current_user_role() = 'admin');

create policy delete_monthly_billing_runs
  on app_public.monthly_billing_runs for delete
  using (app_public.current_user_role() = 'admin');

-- ============================================================================
-- 3. Eligible family-student pairs for a billing month
-- ============================================================================
-- Returns one row per active recurring schedule with family and rate info.
-- The caller groups by (family_id, student_id) for per-student billing.

create function app_public.monthly_billing_eligible(
  p_billing_month date
) returns table(
  family_id uuid,
  student_id uuid,
  student_rate_id uuid,
  rate_cents integer,
  lesson_duration_minutes integer,
  location_type app_public.location_type,
  schedule_id uuid,
  day_of_week smallint,
  local_start_time time without time zone,
  timezone text,
  starts_on date,
  ends_on date,
  family_slug text
) security definer
  set search_path to pg_catalog
  language sql stable as $$
  select distinct on (rs.id)
    fm.family_id,
    sr.student_id,
    sr.id as student_rate_id,
    sr.rate_cents,
    sr.lesson_duration_minutes,
    sr.location_type,
    rs.id as schedule_id,
    rs.day_of_week,
    rs.local_start_time,
    rs.timezone,
    rs.starts_on,
    rs.ends_on,
    f.slug as family_slug
  from app_public.recurring_schedules rs
  join app_public.student_rates sr
    on sr.id = rs.student_rate_id
    and sr.billing_model = 'monthly_prepaid'
  join app_public.family_memberships fm
    on fm.user_id = sr.student_id
  join app_public.families f
    on f.id = fm.family_id
  where rs.active
    and rs.starts_on <= (p_billing_month + interval '1 month - 1 day')::date
    and (rs.ends_on is null or rs.ends_on >= p_billing_month)
  order by rs.id, fm.is_billing_contact desc nulls last
$$;

comment on function app_public.monthly_billing_eligible(date) is
  'Returns all active recurring schedule rows active within the billing month, with family and rate info.';

-- ============================================================================
-- 4. Compute occurrence count for a schedule within a billing month
-- ============================================================================

create function app_public.monthly_occurrence_count(
  p_starts_on date,
  p_ends_on date,
  p_billing_month date,
  p_day_of_week smallint
) returns integer
  security definer
  set search_path to pg_catalog
  language sql stable as $$
  with period as (
    select
      greatest(p_starts_on, p_billing_month) as period_start,
      least(
        coalesce(p_ends_on, (p_billing_month + interval '1 month - 1 day')::date),
        (p_billing_month + interval '1 month - 1 day')::date
      ) as period_end
  )
  select count(*)::integer
  from period, generate_series(
    period_start,
    period_end,
    interval '1 day'
  ) d(day)
  where extract(isodow from d.day) = p_day_of_week;
$$;

comment on function app_public.monthly_occurrence_count is
  'Counts ISO weekday occurrences within a date range clipped to the billing month.';

-- ============================================================================
-- 5. Effective discount at a point in time
-- ============================================================================
-- NOTE: student_rates has no effective-date history — the single current rate
-- per (student_id, location_type) is used. Dated rate history is future work.

create function app_public.get_effective_discount(
  p_family_id uuid,
  p_on_date date
) returns table(
  discount_type text,
  discount_value integer,
  applies_to text,
  label text
) security definer
  set search_path to pg_catalog
  language sql stable as $$
  select
    fd.discount_type,
    fd.discount_value,
    fd.applies_to,
    fd.label
  from app_public.family_discounts fd
  where fd.family_id = p_family_id
    and fd.is_active
    and fd.effective_from <= p_on_date
    and (fd.effective_until is null or fd.effective_until >= p_on_date)
  order by fd.created_at
  limit 1;
$$;

comment on function app_public.get_effective_discount is
  'Returns the single active discount for a family on a given date, or empty if none.';

-- ============================================================================
-- 6. Effective tax rate at a point in time
-- ============================================================================

create function app_public.get_effective_tax_rate(
  p_family_id uuid,
  p_on_date date
) returns table(
  tax_rate_id uuid,
  label text,
  jurisdiction text,
  rate_percent numeric(5,2),
  applies_to text
) security definer
  set search_path to pg_catalog
  language sql stable as $$
  select
    tr.id,
    tr.label,
    tr.jurisdiction,
    tr.rate_percent,
    tr.applies_to
  from app_public.tax_rates tr
  where tr.is_active
    and tr.effective_from <= p_on_date
    and (tr.effective_until is null or tr.effective_until >= p_on_date)
    and not exists (
      select 1 from app_public.family_tax_exemptions fte
      where fte.family_id = p_family_id
        and fte.tax_rate_id = tr.id
        and fte.effective_from <= p_on_date
        and (fte.effective_until is null or fte.effective_until >= p_on_date)
    )
  order by tr.created_at
  limit 1;
$$;

comment on function app_public.get_effective_tax_rate is
  'Returns the single applicable tax rate for a family on a given date, or empty if exempt/none.';

-- ============================================================================
-- 7. Create line items for one student from recurring schedules
-- ============================================================================
-- Per-student: called once per student by the main loop, not per-family.
-- Discount and tax are still applied at the family level (via family_id).

create function app_public.create_monthly_bill_line_items(
  p_bill_id uuid,
  p_student_id uuid,
  p_billing_month date,
  p_due_date date
) returns table(
  student_id uuid,
  line_type text,
  description text,
  quantity integer,
  unit_price_cents integer,
  amount_cents integer,
  schedule_id uuid
) security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_subtotal integer := 0;
  v_discount_cents integer := 0;
  v_tax_cents integer := 0;
  v_total_cents integer := 0;
  v_discount record;
  v_tax record;
  v_month_name text;
  v_year text;
  v_line record;
  v_family_id uuid;
begin
  select to_char(p_billing_month, 'FMMonth') into v_month_name;
  select to_char(p_billing_month, 'YYYY') into v_year;

  -- Get the family_id for this student from the eligible rows
  select e.family_id into v_family_id
  from app_public.monthly_billing_eligible(p_billing_month) e
  where e.student_id = p_student_id
  limit 1;

  for v_line in
    select
      e.student_id,
      e.schedule_id,
      e.rate_cents,
      e.lesson_duration_minutes,
      e.timezone,
      e.day_of_week,
      e.starts_on,
      e.ends_on,
      e.location_type,
      app_public.monthly_occurrence_count(e.starts_on, e.ends_on, p_billing_month, e.day_of_week) as occurrence_count
    from app_public.monthly_billing_eligible(p_billing_month) e
    where e.student_id = p_student_id
  loop
    if v_line.occurrence_count = 0 then
      continue;
    end if;

    insert into app_public.bill_line_items (
      bill_id, student_id, line_type, description,
      quantity, unit_price_cents, amount_cents
    ) values (
      p_bill_id,
      v_line.student_id,
      'lesson',
      v_line.occurrence_count || ' × ' || v_line.lesson_duration_minutes || 'min lesson — ' || v_month_name || ' ' || v_year,
      v_line.occurrence_count,
      v_line.rate_cents,
      v_line.occurrence_count * v_line.rate_cents
    );

    v_subtotal := v_subtotal + (v_line.occurrence_count * v_line.rate_cents);
  end loop;

  -- Apply discount (snapshotted on bill, not as a line item)
  select * into v_discount
  from app_public.get_effective_discount(v_family_id, p_billing_month);

  if found then
    if v_discount.discount_type = 'percentage' then
      v_discount_cents := round(v_subtotal * v_discount.discount_value / 100.0)::integer;
    else
      v_discount_cents := least(v_discount.discount_value, v_subtotal);
    end if;
  end if;

  -- Apply tax (snapshotted on bill)
  select * into v_tax
  from app_public.get_effective_tax_rate(v_family_id, p_billing_month);

  if found then
    v_tax_cents := round((v_subtotal - v_discount_cents) * v_tax.rate_percent / 100.0)::integer;
  end if;

  v_total_cents := v_subtotal - v_discount_cents + v_tax_cents;

  update app_public.bills
    set
      subtotal_cents = v_subtotal,
      discount_cents = v_discount_cents,
      tax_cents = v_tax_cents,
      total_cents = v_total_cents,
      due_date = p_due_date
    where id = p_bill_id;

  return query
  select
    bli.student_id,
    bli.line_type::text,
    bli.description,
    bli.quantity,
    bli.unit_price_cents,
    bli.amount_cents,
    null::uuid
  from app_public.bill_line_items bli
  where bli.bill_id = p_bill_id;
end;
$$;

comment on function app_public.create_monthly_bill_line_items is
  'Creates line items on a draft bill from one student recurring schedules and updates bill totals. Returns inserted rows.';

-- ============================================================================
-- 8. Enqueue lesson generation for a student/month (decoupled from payment)
-- ============================================================================

create function app_public.enqueue_monthly_lesson_generation(
  p_student_id uuid,
  p_billing_month date
) returns void
  security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_job_key text;
begin
  v_job_key := 'lessons__generate_prepaid_period:auto:' || p_student_id || ':' || to_char(p_billing_month, 'YYYY-MM');
  perform graphile_worker.add_job(
    'lessons__generate_prepaid_period',
    json_build_object(
      'studentId', p_student_id,
      'billingMonth', to_char(p_billing_month, 'YYYY-MM-DD')
    ),
    job_key := v_job_key,
    job_key_mode := 'replace'
  );
end;
$$;

comment on function app_public.enqueue_monthly_lesson_generation is
  'Queues lesson generation for a student for a given billing month. Decoupled from payment recording.';

-- ============================================================================
-- 9. Main entry point: issue monthly bills for a billing month
-- ============================================================================
-- Iterates per student (not per family). Due date is 5th of billing month.
-- Idempotency key: (student_id, billing_month) in monthly_billing_runs.

create function app_public.issue_monthly_bills(
  p_billing_month date
) returns jsonb
  security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_due_date date;
  v_student record;
  v_family_id uuid;
  v_bill_number integer;
  v_bill_id uuid;
  v_line_count integer;
  v_summary jsonb;
  v_students_processed integer := 0;
  v_bills_created integer := 0;
  v_bills_skipped integer := 0;
  v_errors integer := 0;
  v_error_detail text;
begin
  if p_billing_month is null or p_billing_month <> date_trunc('month', p_billing_month)::date then
    raise exception 'p_billing_month must be the first day of a month';
  end if;

  -- Due date: 5th of the billing month (same month)
  v_due_date := p_billing_month + 4;
  -- e.g. billing_month = 2026-07-01 → due_date = 2026-07-05

  for v_student in
    select distinct e.family_id, e.student_id
    from app_public.monthly_billing_eligible(p_billing_month) e
    order by e.family_id, e.student_id
  loop
    v_students_processed := v_students_processed + 1;

    -- Idempotency: skip if this student already has a completed billing run for this month
    if exists (
      select 1 from app_public.monthly_billing_runs
      where student_id = v_student.student_id
        and billing_month = p_billing_month
        and status = 'completed'
    ) then
      v_bills_skipped := v_bills_skipped + 1;
      continue;
    end if;

    -- Per-student draft check: a draft bill for student A must not block student B.
    -- We check via bill_line_items so each student gets their own bill.
    if exists (
      select 1 from app_public.bills b
      join app_public.bill_line_items bli on bli.bill_id = b.id
      where b.family_id = v_student.family_id
        and b.billing_period_start = p_billing_month
        and b.status = 'draft'
        and bli.student_id = v_student.student_id
    ) then
      v_bills_skipped := v_bills_skipped + 1;
      continue;
    end if;

    -- If a failed run exists for this student, clear it so we can retry
    delete from app_public.monthly_billing_runs
    where student_id = v_student.student_id
      and billing_month = p_billing_month
      and status = 'failed';

    begin
      -- Generate bill number for the family
      select app_public.next_bill_number(v_student.family_id) into v_bill_number;

      -- Create draft bill (one per student, keyed to the family)
      insert into app_public.bills (
        family_id, bill_number, status,
        billing_period_start, billing_period_end, due_date,
        subtotal_cents, discount_cents, tax_cents, total_cents
      ) values (
        v_student.family_id, v_bill_number, 'draft',
        p_billing_month,
        (p_billing_month + interval '1 month - 1 day')::date,
        v_due_date,
        0, 0, 0, 0
      ) returning id into v_bill_id;

      -- Create line items from schedules for this student
      perform app_public.create_monthly_bill_line_items(
        v_bill_id, v_student.student_id, p_billing_month, v_due_date
      );

      -- Re-read bill to verify total > 0
      select count(*) into v_line_count
      from app_public.bill_line_items
      where bill_id = v_bill_id;

      if v_line_count = 0 then
        -- No active occurrences - cancel the draft bill
        update app_public.bills
        set status = 'cancelled', cancelled_at = now()
        where id = v_bill_id;
        continue;
      end if;

      -- Issue the bill
      update app_public.bills
      set status = 'issued', issued_at = now()
      where id = v_bill_id;

      -- Record the billing run
      insert into app_public.monthly_billing_runs (
        family_id, student_id, billing_month, bill_id, due_date, status
      ) values (
        v_student.family_id, v_student.student_id, p_billing_month, v_bill_id, v_due_date, 'completed'
      );

      v_bills_created := v_bills_created + 1;

      -- Enqueue lesson generation for this student (decoupled from payment)
      perform app_public.enqueue_monthly_lesson_generation(v_student.student_id, p_billing_month);

    exception when others then
      GET STACKED DIAGNOSTICS v_error_detail = MESSAGE_TEXT;
      v_errors := v_errors + 1;
      -- Record failure
      insert into app_public.monthly_billing_runs (
        family_id, student_id, billing_month, due_date, status, error
      ) values (
        v_student.family_id, v_student.student_id, p_billing_month, v_due_date, 'failed',
        left(v_student.student_id || ': ' || v_error_detail, 4000)
      )
      on conflict (student_id, billing_month)
      do update set status = 'failed', error = excluded.error;
    end;
  end loop;

  v_summary := jsonb_build_object(
    'billing_month', to_char(p_billing_month, 'YYYY-MM-DD'),
    'due_date', to_char(v_due_date, 'YYYY-MM-DD'),
    'students_processed', v_students_processed,
    'bills_created', v_bills_created,
    'bills_skipped', v_bills_skipped,
    'errors', v_errors
  );

  return v_summary;
end;
$$;

comment on function app_public.issue_monthly_bills(date) is
  'Idempotent monthly bill issuance for a given billing month. Creates one draft
   bill per student (not per family), snapshots rates/discounts/taxes, issues
   them, enqueues decoupled lesson generation, and records billing runs for
   idempotency. Returns JSON summary. Due date = 5th of billing month.';

-- ============================================================================
-- 10. Worker entry point (named-argument wrapper for JS)
-- ============================================================================

create function app_public.issue_monthly_bills_for_month(
  p_billing_month date,
  out result jsonb
) security definer
  set search_path to pg_catalog
  language sql as $$
  select app_public.issue_monthly_bills(p_billing_month);
$$;

-- ============================================================================
-- 11. Security: revoke broad visitor execute on worker-only functions
-- ============================================================================
-- The worker connects as DATABASE_OWNER and can execute SECURITY DEFINER
-- functions. DATABASE_VISITOR (authenticated web users) must not be able to
-- trigger billing issuance or job enqueue. Helper/query functions remain
-- callable for admin inspection via RLS.

-- Revoke from public (all roles except owner/superuser) and from the default
-- privilege grant to :DATABASE_VISITOR (applied by ALTER DEFAULT PRIVILEGES
-- in 0020-schemas.sql when functions are created in app_public).
-- After these revokes, only the function owner (DATABASE_OWNER) and superusers
-- can execute these worker-only functions. Neither the authenticator role nor
-- the visitor role (web users) can trigger billing issuance.
revoke execute on function app_public.issue_monthly_bills(date)
  from public, :DATABASE_VISITOR;

revoke execute on function app_public.issue_monthly_bills_for_month(date)
  from public, :DATABASE_VISITOR;

revoke execute on function app_public.enqueue_monthly_lesson_generation(uuid, date)
  from public, :DATABASE_VISITOR;

revoke execute on function app_public.create_monthly_bill_line_items(uuid, uuid, date, date)
  from public, :DATABASE_VISITOR;

--! split: 0334-billing-rate-history.sql
-- Billing rate history, discount/tax snapshots, and security hardening.

-- ============================================================================
-- 1. Discount/tax snapshot details on bills
-- ============================================================================
-- Persist the full configuration (type, value, rate, exemption identity) on
-- the bill — not just aggregate cents — for audit completeness.

alter table app_public.bills
  add column if not exists discount_details jsonb,
  add column if not exists tax_details jsonb;

comment on column app_public.bills.discount_details is
  'Snapshot of discount configuration at issue time: {label, discount_type, discount_value, applies_to}. Null if no discount was applied.';
comment on column app_public.bills.tax_details is
  'Snapshot of tax configuration at issue time: {label, jurisdiction, rate_percent, applies_to, tax_rate_id, exemption_id}. Null if no tax was applied.';

-- ============================================================================
-- 2. Student rate history (effective-dated)
-- ============================================================================
-- Records the rate that was in effect for a student at any point in time.
-- Populated automatically whenever a new row is inserted into student_rates.
-- The billing function uses this history to compute the correct rate for the
-- billing month, rather than silently using whatever rate happens to be
-- current when the worker runs.
--
-- NOTE: Only forward-looking history is captured (insert trigger). Old data
-- is not backfilled. Billing periods before this migration use the rate
-- that was current when billing ran, which is the best we can do without
-- manual entry of historical rate changes.

create table if not exists app_public.student_rate_history (
  id uuid primary key default gen_random_uuid(),
  student_rate_id uuid not null references app_public.student_rates(id) on delete cascade,
  student_id uuid not null references app_public.users(id) on delete cascade,
  rate_cents integer not null check (rate_cents >= 0),
  lesson_duration_minutes integer not null check (lesson_duration_minutes in (30, 60)),
  location_type app_public.location_type not null,
  billing_model app_public.billing_model not null,
  effective_from date not null,
  effective_until date,
  created_at timestamptz not null default now(),
  check (effective_until is null or effective_until >= effective_from)
);

alter table app_public.student_rate_history enable row level security;

create index if not exists srh_student_period
  on app_public.student_rate_history(student_id, effective_from);
create index if not exists srh_rate_id
  on app_public.student_rate_history(student_rate_id);

grant select on app_public.student_rate_history to :DATABASE_VISITOR;

comment on table app_public.student_rate_history is
  'Effective-dated record of student rate changes. Populated by trigger on student_rates INSERT.';

create policy select_student_rate_history on app_public.student_rate_history for select
  using (app_public.current_user_role() = 'admin');

-- Seed history for existing student_rates
insert into app_public.student_rate_history (
  student_rate_id, student_id, rate_cents, lesson_duration_minutes,
  location_type, billing_model, effective_from
)
select id, student_id, rate_cents, lesson_duration_minutes,
       location_type, billing_model, created_at::date
from app_public.student_rates
on conflict do nothing;

-- Trigger: record the effective value whenever a rate is inserted or changed.
-- The admin upsert updates the existing student_rates row, so an insert-only
-- trigger would silently keep billing at the original rate forever.
create or replace function app_private.tg_student_rates__record_history()
returns trigger
  security definer
  set search_path to pg_catalog
  language plpgsql as $$
begin
  if TG_OP = 'UPDATE' then
    delete from app_public.student_rate_history
     where student_rate_id = NEW.id
       and effective_from = current_date;

    update app_public.student_rate_history
       set effective_until = current_date - 1
     where student_rate_id = NEW.id
       and effective_until is null
       and effective_from < current_date;
  end if;

  insert into app_public.student_rate_history (
    student_rate_id, student_id, rate_cents, lesson_duration_minutes,
    location_type, billing_model, effective_from
  ) values (
    NEW.id, NEW.student_id, NEW.rate_cents, NEW.lesson_duration_minutes,
    NEW.location_type, NEW.billing_model, current_date
  );
  return NEW;
end;
$$;

drop trigger if exists _record_history on app_public.student_rates;
create trigger _record_history
  after insert or update on app_public.student_rates
  for each row execute function app_private.tg_student_rates__record_history();

-- ============================================================================
-- 3. Drop old functions before recreating with new return types
-- ============================================================================
-- Must DROP before CREATE because the return type changes from record to jsonb.
-- Drops are safe in a transaction: 0333 has no DROP TABLE with CASCADE that
-- would propagate, and graphile-migrate runs each file in its own transaction.

drop function if exists app_public.create_monthly_bill_line_items(uuid, uuid, date, date);
drop function if exists app_public.get_effective_discount(uuid, date);
drop function if exists app_public.get_effective_tax_rate(uuid, date);

-- ============================================================================
-- 4. Updated helper functions — return jsonb snapshots (not records)
-- ============================================================================

create or replace function app_public.get_effective_discount(
  p_family_id uuid,
  p_on_date date
) returns jsonb
  security definer
  set search_path to pg_catalog
  language sql stable as $$
  select jsonb_build_object(
    'label', fd.label,
    'discount_type', fd.discount_type,
    'discount_value', fd.discount_value,
    'applies_to', fd.applies_to
  )
  from app_public.family_discounts fd
  where fd.family_id = p_family_id
    and fd.is_active
    and fd.effective_from <= p_on_date
    and (fd.effective_until is null or fd.effective_until >= p_on_date)
  order by fd.created_at
  limit 1;
$$;

create or replace function app_public.get_effective_tax_rate(
  p_family_id uuid,
  p_on_date date
) returns jsonb
  security definer
  set search_path to pg_catalog
  language sql stable as $$
  select jsonb_build_object(
    'tax_rate_id', tr.id,
    'label', tr.label,
    'jurisdiction', tr.jurisdiction,
    'rate_percent', tr.rate_percent,
    'applies_to', tr.applies_to,
    'exemption_id', null::uuid
  )
  from app_public.tax_rates tr
  where tr.is_active
    and tr.effective_from <= p_on_date
    and (tr.effective_until is null or tr.effective_until >= p_on_date)
    and not exists (
      select 1 from app_public.family_tax_exemptions fte
      where fte.family_id = p_family_id
        and fte.tax_rate_id = tr.id
        and fte.effective_from <= p_on_date
        and (fte.effective_until is null or fte.effective_until >= p_on_date)
    )
  order by tr.created_at
  limit 1;
$$;

-- ============================================================================
-- 5. Updated create_monthly_bill_line_items
--    — uses rate history for the billing month
--    — populates discount_details and tax_details on bills
-- ============================================================================

create or replace function app_public.create_monthly_bill_line_items(
  p_bill_id uuid,
  p_student_id uuid,
  p_billing_month date,
  p_due_date date
) returns table(
  student_id uuid,
  line_type text,
  description text,
  quantity integer,
  unit_price_cents integer,
  amount_cents integer,
  schedule_id uuid
) security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_subtotal integer := 0;
  v_discount_cents integer := 0;
  v_tax_cents integer := 0;
  v_total_cents integer := 0;
  v_discount jsonb;
  v_tax jsonb;
  v_month_name text;
  v_year text;
  v_line record;
  v_family_id uuid;
  v_effective_rate_cents integer;
  v_line_tax integer;
begin
  select to_char(p_billing_month, 'FMMonth') into v_month_name;
  select to_char(p_billing_month, 'YYYY') into v_year;

  select e.family_id into v_family_id
  from app_public.monthly_billing_eligible(p_billing_month) e
  where e.student_id = p_student_id
  limit 1;

  -- Expand occurrences before selecting rate history. A rate change in the
  -- middle of a month must affect only the lessons on or after its effective
  -- date, rather than retroactively pricing the whole billing period.
  for v_line in
    select
      occurrences.student_id,
      occurrences.schedule_id,
      occurrences.effective_rate_cents as rate_cents,
      occurrences.lesson_duration_minutes,
      occurrences.location_type,
      count(*)::integer as occurrence_count
    from (
      select
        e.student_id,
        e.schedule_id,
        coalesce(rate.lesson_duration_minutes, e.lesson_duration_minutes) as lesson_duration_minutes,
        coalesce(rate.location_type, e.location_type) as location_type,
        coalesce(
          rate.rate_cents,
          e.rate_cents
        ) as effective_rate_cents
      from app_public.monthly_billing_eligible(p_billing_month) e
      cross join lateral generate_series(
        greatest(e.starts_on, p_billing_month),
        least(
          coalesce(e.ends_on, (p_billing_month + interval '1 month - 1 day')::date),
          (p_billing_month + interval '1 month - 1 day')::date
        ),
        interval '1 day'
      ) as occurrence_dates(occurrence_date)
      left join lateral (
        select srh.rate_cents, srh.lesson_duration_minutes, srh.location_type
        from app_public.student_rate_history srh
        where srh.student_rate_id = e.student_rate_id
          and srh.effective_from <= occurrence_dates.occurrence_date::date
          and (srh.effective_until is null or srh.effective_until >= occurrence_dates.occurrence_date::date)
        order by srh.effective_from desc
        limit 1
      ) rate on true
      where e.student_id = p_student_id
        and extract(isodow from occurrence_dates.occurrence_date)::smallint = e.day_of_week
    ) occurrences
    group by occurrences.student_id, occurrences.schedule_id,
      occurrences.effective_rate_cents, occurrences.lesson_duration_minutes,
      occurrences.location_type
    order by occurrences.schedule_id, occurrences.effective_rate_cents
  loop
    if v_line.occurrence_count = 0 then
      continue;
    end if;

    v_effective_rate_cents := v_line.rate_cents;

    insert into app_public.bill_line_items (
      bill_id, student_id, line_type, description,
      quantity, unit_price_cents, amount_cents
    ) values (
      p_bill_id,
      v_line.student_id,
      'lesson',
      v_line.occurrence_count || ' × ' || v_line.lesson_duration_minutes || 'min lesson — ' || v_month_name || ' ' || v_year,
       v_line.occurrence_count,
      v_effective_rate_cents,
      v_line.occurrence_count * v_effective_rate_cents
    );

    v_subtotal := v_subtotal + (v_line.occurrence_count * v_effective_rate_cents);
  end loop;

  -- Apply discount (snapshotted as jsonb on bill)
  v_discount := app_public.get_effective_discount(v_family_id, p_billing_month);
  if v_discount is not null and (v_discount->>'applies_to') in ('all', 'tuition') then
    if (v_discount->>'discount_type') = 'percentage' then
      v_discount_cents := round(v_subtotal * (v_discount->>'discount_value')::numeric / 100.0)::integer;
    else
      v_discount_cents := least((v_discount->>'discount_value')::integer, v_subtotal);
    end if;
  end if;

  -- Apply tax (snapshotted as jsonb on bill)
  v_tax := app_public.get_effective_tax_rate(v_family_id, p_billing_month);
  if v_tax is not null and (v_tax->>'applies_to') in ('all', 'tuition') then
    -- Tax is rounded per line after the line's discount, as required by the
    -- billing rules. Fixed discounts are applied to the bill aggregate.
    if v_discount is not null and (v_discount->>'discount_type') = 'percentage' then
      for v_line in
        select bli.amount_cents
          from app_public.bill_line_items bli
         where bli.bill_id = p_bill_id
      loop
        v_line_tax := round(
          (v_line.amount_cents - round(v_line.amount_cents * (v_discount->>'discount_value')::numeric / 100.0))
          * (v_tax->>'rate_percent')::numeric / 100.0
        )::integer;
        v_tax_cents := v_tax_cents + v_line_tax;
      end loop;
    else
      -- Fixed discounts are allocated proportionally before rounding each
      -- taxable line, so aggregate tax cannot change with line grouping.
      for v_line in
        select bli.amount_cents,
               case when v_subtotal = 0 then 0
                    else round(bli.amount_cents * v_discount_cents::numeric / v_subtotal)::integer
               end as line_discount
          from app_public.bill_line_items bli
         where bli.bill_id = p_bill_id
      loop
        v_line_tax := round(
          (v_line.amount_cents - v_line.line_discount)
          * (v_tax->>'rate_percent')::numeric / 100.0
        )::integer;
        v_tax_cents := v_tax_cents + v_line_tax;
      end loop;
    end if;
  end if;

  v_total_cents := v_subtotal - v_discount_cents + v_tax_cents;

  update app_public.bills
    set
      subtotal_cents = v_subtotal,
      discount_cents = v_discount_cents,
      tax_cents = v_tax_cents,
      total_cents = v_total_cents,
      due_date = p_due_date,
      discount_details = v_discount,
      tax_details = v_tax
    where id = p_bill_id;

  return query
  select
    bli.student_id,
    bli.line_type::text,
    bli.description,
    bli.quantity,
    bli.unit_price_cents,
    bli.amount_cents,
    null::uuid
  from app_public.bill_line_items bli
  where bli.bill_id = p_bill_id;
end;
$$;

comment on function app_public.create_monthly_bill_line_items is
  'Creates line items from recurring schedules for one student, using effective-dated rate history. Populates discount/tax snapshot details on the bill.';

-- ============================================================================
-- 6. Security: revoke execute on billing SECURITY DEFINER functions
-- ============================================================================
-- 0333 already revokes mutation entrypoints; this adds the remaining billing
-- SECURITY DEFINER functions so no visitor/parent/teacher can invoke them.

-- next_bill_number and next_payment_number are SECURITY DEFINER helpers
-- called from within withAuthContext (visitor role); they must remain
-- executable. current_user_is_billing_contact_for is unused in active RLS
-- but kept callable for potential policy use.
--
-- Worker entrypoints already revoked in 0333. Revoke query helpers below
-- — these are called internally by SECURITY DEFINER functions, never
-- directly by visitors.

revoke execute on function app_public.monthly_billing_eligible(date)
  from public, :DATABASE_VISITOR;

revoke execute on function app_public.monthly_occurrence_count(date, date, date, smallint)
  from public, :DATABASE_VISITOR;

revoke execute on function app_public.get_effective_discount(uuid, date)
  from public, :DATABASE_VISITOR;

revoke execute on function app_public.get_effective_tax_rate(uuid, date)
  from public, :DATABASE_VISITOR;

--! split: 0335-financial-audit-number-safety.sql
-- Financial audit history + document number safety.
--
-- 1. Populate financial_audit_events via SECURITY DEFINER triggers on all
--    core financial tables. Audit rows are append-only (immutable trigger).
-- 2. Replace transactional per-family counters with non-transactional global
--    sequences so document numbers are consumed even when the ledger
--    transaction rolls back. Gaps are expected and acceptable.

-- ============================================================================
-- 1. Document number safety — non-transactional global sequences
-- ============================================================================
-- PostgreSQL sequences are non-transactional: nextval() advances the counter
-- and that advancement is never rolled back. This guarantees that a consumed
-- bill or payment number is never reused after a failed transaction.
--
-- We preserve the (family_id, bill_number) UNIQUE constraint — since sequence
-- values are globally unique across all families, no two records can share the
-- same (family_id, bill_number) pair within a family.
--
-- PostgreSQL sequences are non-transactional, so failed ledger transactions
-- consume numbers and leave gaps rather than reusing them. Numbers are global
-- identifiers; the existing family-local uniqueness constraints remain intact.

comment on column app_public.bills.bill_number is
  'Globally sequential document identifier. Allocation is non-transactional and may contain gaps.';
comment on column app_public.payments.payment_number is
  'Globally sequential receipt identifier. Allocation is non-transactional and may contain gaps.';

create sequence if not exists app_public.bill_number_seq as integer
  minvalue 1 no maxvalue no cycle;

create sequence if not exists app_public.payment_number_seq as integer
  minvalue 1 no maxvalue no cycle;

do $$ begin
  perform setval(
    'app_public.bill_number_seq',
    (select coalesce(max(bill_number), 0) + 1 from app_public.bills),
    false
  );
  perform setval(
    'app_public.payment_number_seq',
    (select coalesce(max(payment_number), 0) + 1 from app_public.payments),
    false
  );
end $$;

create or replace function app_public.next_bill_number(p_family_id uuid)
returns integer
language plpgsql volatile security definer set search_path to pg_catalog as $$
begin
  return nextval('app_public.bill_number_seq')::integer;
end;
$$;

create or replace function app_public.next_payment_number(p_family_id uuid)
returns integer
language plpgsql volatile security definer set search_path to pg_catalog as $$
begin
  return nextval('app_public.payment_number_seq')::integer;
end;
$$;

comment on function app_public.next_bill_number(uuid) is
  'Returns the next globally unique bill number. Allocation is irrevocable and non-transactional; gaps may occur.';

comment on function app_public.next_payment_number(uuid) is
  'Returns the next globally unique payment number. Allocation is irrevocable and non-transactional; gaps may occur.';

-- ============================================================================
-- 2. Financial audit trigger function (SECURITY DEFINER)
-- ============================================================================
-- Records every INSERT/UPDATE/DELETE on core financial tables. Runs as the
-- function owner (database owner) so it bypasses RLS and always succeeds.
-- actor_id is resolved from the session context; null for background workers.

create or replace function app_private.tg__audit_record() returns trigger
  security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_actor_id  uuid;
  v_table     text;
  v_record_id uuid;
begin
  v_actor_id := app_public.current_user_id();
  v_table    := TG_TABLE_NAME;

  if TG_OP in ('UPDATE', 'DELETE') then
    v_record_id := OLD.id;
  else
    v_record_id := NEW.id;
  end if;

  insert into app_public.financial_audit_events
    (actor_id, action, table_name, record_id, old_values, new_values)
  values (
    v_actor_id,
    lower(TG_OP),
    v_table,
    v_record_id,
    case when TG_OP in ('DELETE', 'UPDATE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end
  );

  return coalesce(NEW, OLD);
end;
$$;

comment on function app_private.tg__audit_record() is
  'SECURITY DEFINER trigger function that records financial DML in financial_audit_events. Attach via AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.';

-- ============================================================================
-- 3. Immutable trigger for financial_audit_events
-- ============================================================================
-- Prevents even the database owner from altering or deleting audit rows.
-- Without this, RLS allows admin INSERT — but UPDATE/DELETE have no policies
-- (implicitly denied by RLS for non-owner). The trigger catches owner-level
-- modifications that bypass RLS.

create or replace function app_private.tg_financial_audit__immutable()
returns trigger
  language plpgsql as $$
begin
  raise exception 'financial_audit_events are append-only; modification is not permitted';
end;
$$;

create trigger _immutable
  before update or delete on app_public.financial_audit_events
  for each row execute function app_private.tg_financial_audit__immutable();

-- ============================================================================
-- 4. Audit triggers — all 10 core financial tables
-- ============================================================================
-- Each trigger fires AFTER the DML so the audit record captures the committed
-- state. The trigger function is SECURITY DEFINER so it can insert into
-- financial_audit_events regardless of the calling user's RLS permissions.

-- 4a. bills
create trigger _audit
  after insert or update or delete on app_public.bills
  for each row execute function app_private.tg__audit_record();

-- 4b. bill_line_items
create trigger _audit
  after insert or update or delete on app_public.bill_line_items
  for each row execute function app_private.tg__audit_record();

-- 4c. payments
create trigger _audit
  after insert or update or delete on app_public.payments
  for each row execute function app_private.tg__audit_record();

-- 4d. payment_allocations
create trigger _audit
  after insert or update or delete on app_public.payment_allocations
  for each row execute function app_private.tg__audit_record();

-- 4e. family_credits
create trigger _audit
  after insert or update or delete on app_public.family_credits
  for each row execute function app_private.tg__audit_record();

-- 4f. refunds
create trigger _audit
  after insert or update or delete on app_public.refunds
  for each row execute function app_private.tg__audit_record();

-- 4g. bill_adjustments
create trigger _audit
  after insert or update or delete on app_public.bill_adjustments
  for each row execute function app_private.tg__audit_record();

-- 4h. family_discounts
create trigger _audit
  after insert or update or delete on app_public.family_discounts
  for each row execute function app_private.tg__audit_record();

-- 4i. tax_rates
create trigger _audit
  after insert or update or delete on app_public.tax_rates
  for each row execute function app_private.tg__audit_record();

-- 4j. family_tax_exemptions
create trigger _audit
  after insert or update or delete on app_public.family_tax_exemptions
  for each row execute function app_private.tg__audit_record();

-- ============================================================================
-- 5. RLS for financial_audit_events — append-only
-- ============================================================================
-- The existing RLS policies (from 0330/0331) already allow SELECT and INSERT
-- for admin only. No UPDATE/DELETE policies exist, so RLS implicitly denies
-- those operations for all non-owner roles. The immutable trigger above
-- catches owner-level modifications.
--
-- We add explicit REVOKE for UPDATE/DELETE on the audit table so even direct
-- SQL by the visitor role is prevented at the permission layer (in addition
-- to RLS denial and the immutable trigger).

-- No explicit REVOKE needed: RLS already denies UPDATE/DELETE (no policies
-- exist for those operations). The immutable trigger above catches
-- owner-level modifications that bypass RLS.
--
-- The default privilege grant in 0020-schemas.sql grants USAGE on all
-- app_public sequences to :DATABASE_VISITOR. These new sequences are in
-- app_public so the default privilege covers them automatically.

--! split: 0336-ledger-invariants.sql
-- Enforce ledger relationships at the database boundary.

create or replace function app_private.tg_payment_allocations__validate()
returns trigger
security definer
set search_path to pg_catalog
language plpgsql as $$
declare
  v_payment_family uuid;
  v_payment_amount integer;
  v_bill_family uuid;
  v_bill_status app_public.bill_status;
  v_allocated integer;
  v_bill_total integer;
  v_bill_adjustments integer;
  v_bill_credits integer;
  v_bill_payments integer;
begin
  select family_id, amount_cents into v_payment_family, v_payment_amount
    from app_public.payments where id = NEW.payment_id for update;
  select family_id, status, total_cents into v_bill_family, v_bill_status, v_bill_total
    from app_public.bills where id = NEW.bill_id for update;
  select coalesce(sum(amount_cents), 0) into v_bill_adjustments from app_public.bill_adjustments where bill_id = NEW.bill_id;
  select coalesce(sum(amount_cents), 0) into v_bill_credits from app_public.family_credit_applications where bill_id = NEW.bill_id;
  select coalesce(sum(amount_cents), 0) into v_bill_payments from app_public.payment_allocations where bill_id = NEW.bill_id and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_payment_family is null or v_bill_family is null
     or v_payment_family <> v_bill_family then
    raise exception 'Payment and bill must belong to the same family';
  end if;
  if v_bill_status not in ('issued', 'paid') then
    raise exception 'Payments can only be allocated to issued bills';
  end if;

  select coalesce(sum(amount_cents), 0) into v_allocated
    from app_public.payment_allocations
   where payment_id = NEW.payment_id
     and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_allocated + NEW.amount_cents > v_payment_amount then
    raise exception 'Payment allocations exceed the payment amount';
  end if;
  if NEW.amount_cents > greatest(0, v_bill_total + v_bill_adjustments - v_bill_credits - v_bill_payments) then
    raise exception 'Payment allocation exceeds the bill outstanding balance';
  end if;
  return NEW;
end;
$$;

drop trigger if exists _validate on app_public.payment_allocations;
create trigger _validate
  before insert or update on app_public.payment_allocations
  for each row execute function app_private.tg_payment_allocations__validate();

create or replace function app_private.tg_credit_applications__validate()
returns trigger
security definer
set search_path to pg_catalog
language plpgsql as $$
declare
  v_credit_family uuid;
  v_credit_amount integer;
  v_bill_family uuid;
  v_bill_status app_public.bill_status;
  v_applied integer;
  v_bill_total integer;
  v_bill_adjustments integer;
  v_bill_credits integer;
  v_bill_payments integer;
begin
  select family_id, amount_cents into v_credit_family, v_credit_amount
    from app_public.family_credits where id = NEW.credit_id for update;
  select family_id, status, total_cents into v_bill_family, v_bill_status, v_bill_total
    from app_public.bills where id = NEW.bill_id for update;
  select coalesce(sum(amount_cents), 0) into v_bill_adjustments from app_public.bill_adjustments where bill_id = NEW.bill_id;
  select coalesce(sum(amount_cents), 0) into v_bill_credits from app_public.family_credit_applications where bill_id = NEW.bill_id and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  select coalesce(sum(amount_cents), 0) into v_bill_payments from app_public.payment_allocations where bill_id = NEW.bill_id;
  if v_credit_family is null or v_bill_family is null
     or v_credit_family <> v_bill_family then
    raise exception 'Credit and bill must belong to the same family';
  end if;
  if v_bill_status not in ('issued', 'paid') then
    raise exception 'Credits can only be applied to issued bills';
  end if;
  select coalesce(sum(amount_cents), 0) into v_applied
    from app_public.family_credit_applications
   where credit_id = NEW.credit_id
     and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_applied + NEW.amount_cents > v_credit_amount then
    raise exception 'Credit applications exceed the credit amount';
  end if;
  if NEW.amount_cents > greatest(0, v_bill_total + v_bill_adjustments - v_bill_credits - v_bill_payments) then
    raise exception 'Credit application exceeds the bill outstanding balance';
  end if;
  return NEW;
end;
$$;

drop trigger if exists _validate on app_public.family_credit_applications;
create trigger _validate
  before insert or update on app_public.family_credit_applications
  for each row execute function app_private.tg_credit_applications__validate();

create or replace function app_private.tg_credit_applications__consume()
returns trigger
security definer
set search_path to pg_catalog
language plpgsql as $$
begin
  update app_public.family_credits
     set consumed_at = coalesce(consumed_at, now())
   where id = NEW.credit_id
     and consumed_at is null
     and (select coalesce(sum(amount_cents), 0)
            from app_public.family_credit_applications
           where credit_id = NEW.credit_id)
         >= amount_cents;
  return NEW;
end;
$$;

drop trigger if exists _consume on app_public.family_credit_applications;
create trigger _consume
  after insert or update on app_public.family_credit_applications
  for each row execute function app_private.tg_credit_applications__consume();

create or replace function app_private.tg_refunds__validate()
returns trigger
security definer
set search_path to pg_catalog
language plpgsql as $$
declare
  v_amount integer;
  v_refunded integer;
begin
  select amount_cents into v_amount
    from app_public.payments where id = NEW.payment_id for update;
  select coalesce(sum(amount_cents), 0) into v_refunded
    from app_public.refunds
   where payment_id = NEW.payment_id
     and reversed_at is null
     and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_refunded + NEW.amount_cents > v_amount then
    raise exception 'Refunds exceed the payment amount';
  end if;
  return NEW;
end;
$$;

drop trigger if exists _validate on app_public.refunds;
create trigger _validate
  before insert or update on app_public.refunds
  for each row execute function app_private.tg_refunds__validate();

-- Credit applications are financial events and must be audited as well.
drop trigger if exists _audit on app_public.family_credit_applications;
create trigger _audit
  after insert or update or delete on app_public.family_credit_applications
  for each row execute function app_private.tg__audit_record();

--! split: 0337-single-booking-obligations.sql
-- Create the immutable financial obligation at the time a single-booking
-- lesson is reserved. Deposit state is tracked separately on lesson_deposits.

create or replace function app_public.create_single_booking_obligation(
  p_lesson_id uuid,
  p_rate_cents integer
) returns uuid
  security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_student_id uuid;
  v_family_id uuid;
  v_bill_id uuid;
  v_bill_number integer;
  v_lesson_date date;
begin
  if p_rate_cents <= 0 then
    raise exception 'Single-booking rate must be positive';
  end if;

  select student_id, (scheduled_at at time zone 'America/Chicago')::date
    into v_student_id, v_lesson_date
   from app_public.lessons
   where id = p_lesson_id
   for update;
  if v_student_id is null then
    raise exception 'Lesson not found';
  end if;

  select fm.family_id
    into v_family_id
    from app_public.family_memberships fm
   where fm.user_id = v_student_id
   order by fm.is_billing_contact desc, fm.is_owner desc
   limit 1;
  if v_family_id is null then
    raise exception 'Student has no billing family';
  end if;

  if not (
    v_student_id = app_public.current_user_id()
    or v_family_id in (select app_public.current_user_member_family_ids())
  ) then
    raise insufficient_privilege using message = 'Not authorized to create this booking obligation';
  end if;

  select b.id
    into v_bill_id
    from app_public.bill_line_items bli
    join app_public.bills b on b.id = bli.bill_id
   where bli.lesson_id = p_lesson_id
   limit 1;
  if v_bill_id is not null then
    return v_bill_id;
  end if;

  select app_public.next_bill_number(v_family_id) into v_bill_number;
  insert into app_public.bills (
    family_id, bill_number, status, billing_period_start,
    billing_period_end, due_date, subtotal_cents, discount_cents,
    tax_cents, total_cents
  ) values (
    v_family_id, v_bill_number, 'draft', v_lesson_date, v_lesson_date,
    v_lesson_date, p_rate_cents, 0, 0, p_rate_cents
  ) returning id into v_bill_id;

  insert into app_public.bill_line_items (
    bill_id, student_id, line_type, description, quantity,
    unit_price_cents, amount_cents, lesson_id
  ) values (
    v_bill_id, v_student_id, 'single_booking', 'Single lesson booking',
    1, p_rate_cents, p_rate_cents, p_lesson_id
  );

  update app_public.bills
     set status = 'issued', issued_at = now()
   where id = v_bill_id;

  return v_bill_id;
end;
$$;

grant execute on function app_public.create_single_booking_obligation(uuid, integer)
  to :DATABASE_VISITOR;

comment on function app_public.create_single_booking_obligation(uuid, integer) is
  'Creates and issues the immutable bill for a single-booking lesson exactly once.';

create or replace function app_public.settle_single_booking_cancellation(
  p_lesson_id uuid,
  p_deposit_cents integer,
  p_deposit_captured boolean
) returns void
  security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_student_id uuid;
  v_family_id uuid;
  v_bill_id uuid;
  v_reason text;
begin
  select student_id into v_student_id
    from app_public.lessons
   where id = p_lesson_id;
  select fm.family_id into v_family_id
    from app_public.family_memberships fm
   where fm.user_id = v_student_id
   order by fm.is_billing_contact desc, fm.is_owner desc
   limit 1;
  if v_student_id is null or v_family_id is null then
    raise exception 'Booking family not found';
  end if;
  if not (
    v_student_id = app_public.current_user_id()
    or v_family_id in (select app_public.current_user_member_family_ids())
  ) then
    raise insufficient_privilege using message = 'Not authorized to settle this booking';
  end if;

  select b.id into v_bill_id
    from app_public.bill_line_items bli
    join app_public.bills b on b.id = bli.bill_id
   where bli.lesson_id = p_lesson_id
   limit 1;
  if v_bill_id is null then
    return;
  end if;

  update app_public.bills
     set status = case when status in ('draft', 'issued') then 'cancelled' else status end,
         cancelled_at = case when status in ('draft', 'issued') then now() else cancelled_at end
   where id = v_bill_id;

  if p_deposit_captured and p_deposit_cents > 0 then
    v_reason := 'Captured deposit for cancelled single booking ' || p_lesson_id::text;
    insert into app_public.family_credits (
      family_id, student_id, amount_cents, reason, created_by
    )
    select v_family_id, v_student_id, p_deposit_cents, v_reason,
           app_public.current_user_id()
    where not exists (
      select 1 from app_public.family_credits
       where family_id = v_family_id and reason = v_reason
    );
  end if;
end;
$$;

grant execute on function app_public.settle_single_booking_cancellation(uuid, integer, boolean)
  to :DATABASE_VISITOR;

--! split: 0338-payment-credit-provenance.sql
-- Preserve the payment that produced an automatic family credit.
-- This lets balance readers distinguish newly materialized excess payments
-- from legacy payments whose excess was only inferred at read time.

alter table app_public.family_credits
  add column if not exists source_payment_id uuid
    references app_public.payments(id) on delete restrict;

create unique index if not exists family_credits_source_payment
  on app_public.family_credits(source_payment_id)
  where source_payment_id is not null;

comment on column app_public.family_credits.source_payment_id is
  'Payment whose excess amount created this credit; null for manually issued or legacy credits.';

--! split: 0339-single-booking-idempotency.sql
-- A lesson can produce at most one single-booking bill line. The row lock in
-- 0337 serializes normal retries; this invariant also protects direct SQL and
-- future callers from duplicate obligations.

create unique index if not exists bill_line_items_single_booking_lesson
  on app_public.bill_line_items(lesson_id)
  where line_type = 'single_booking' and lesson_id is not null;
