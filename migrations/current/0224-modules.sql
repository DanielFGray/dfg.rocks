create table app_public.modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references app_public.courses(id) on delete cascade,
  title text not null check (length(title) >= 1 and length(title) <= 200),
  description text,
  sort_order integer not null default 0
);

comment on table app_public.modules is 'Ordered subdivisions within a course.';

alter table app_public.modules enable row level security;
create policy select_via_course on app_public.modules for select
  using (
    app_public.current_user_role() = 'admin'
    or course_id in (
      select course_id from app_public.enrollments
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );

grant select on app_public.modules to :DATABASE_VISITOR;
