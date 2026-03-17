create table app_public.users (
  id uuid primary key default gen_random_uuid(),
  username citext not null unique,
  name text not null default '',
  email citext not null unique,
  role app_public.user_role not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger _timestamps
  before insert or update on app_public.users
  for each row execute function app_private.tg__timestamps();

grant select on app_public.users to :DATABASE_VISITOR;

alter table app_public.users enable row level security;
create policy select_own on app_public.users for select
  using (
    app_public.current_user_role() = 'admin'
    or id = app_public.current_user_id()
    or id in (select app_public.current_user_family_student_ids())
  );

create table app_private.user_secrets (
  user_id uuid primary key references app_public.users(id) on delete cascade,
  password_hash text,
  invite_token text,
  invite_token_expires_at timestamptz,
  reset_password_token text,
  reset_password_token_expires_at timestamptz,
  failed_password_attempts int not null default 0,
  first_failed_password_attempt timestamptz,
  last_login_at timestamptz
);

create table app_private.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
