create table app_public.enrollments (
  student_id uuid not null references app_public.users(id) on delete cascade,
  course_id uuid not null references app_public.courses(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (student_id, course_id)
);

alter table app_public.enrollments enable row level security;
grant select, insert, delete on app_public.enrollments to :DATABASE_VISITOR;

comment on table app_public.enrollments is 'Links students to courses they are enrolled in.';
