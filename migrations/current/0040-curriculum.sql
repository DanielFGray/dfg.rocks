create table app_public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  instrument text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger _timestamps
  before insert or update on app_public.courses
  for each row execute function app_private.tg__timestamps();

create table app_public.modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references app_public.courses(id) on delete cascade,
  title text not null,
  description text,
  sort_order integer not null default 0
);

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

create table app_public.module_materials (
  module_id uuid not null references app_public.modules(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (module_id, material_id)
);
