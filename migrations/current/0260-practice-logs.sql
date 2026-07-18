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
