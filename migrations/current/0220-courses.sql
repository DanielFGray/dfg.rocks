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
