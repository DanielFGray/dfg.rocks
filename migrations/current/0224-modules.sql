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
