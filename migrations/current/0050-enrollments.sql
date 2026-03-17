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
