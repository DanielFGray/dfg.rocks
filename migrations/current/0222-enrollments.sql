create table app_public.enrollments (
  student_id uuid not null references app_public.users(id) on delete cascade,
  course_id uuid not null references app_public.courses(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (student_id, course_id)
);

alter table app_public.enrollments enable row level security;
create policy select_own on app_public.enrollments for select
  using (
    app_public.current_user_role() = 'admin'
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );
grant select, insert, delete on app_public.enrollments to :DATABASE_VISITOR;

-- Courses RLS depends on enrollments existing
create policy select_enrolled on app_public.courses for select
  using (
    app_public.current_user_role() = 'admin'
    or id in (
      select course_id from app_public.enrollments
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );

comment on table app_public.enrollments is 'Links students to courses they are enrolled in.';
