create table app_public.enrollments (
  student_id uuid not null references app_public.users(id) on delete cascade,
  course_id uuid not null references app_public.courses(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (student_id, course_id)
);

create table app_public.student_materials (
  student_id uuid not null references app_public.users(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (student_id, material_id)
);

-- Grants (admin inserts only — no direct student self-enroll/assign)
grant insert, delete on app_public.enrollments to :DATABASE_VISITOR;
grant insert, delete on app_public.student_materials to :DATABASE_VISITOR;

-- Comments
comment on table app_public.enrollments is 'Links students to courses they are enrolled in.';
comment on table app_public.student_materials is 'Direct material assignments to individual students (not via course).';
