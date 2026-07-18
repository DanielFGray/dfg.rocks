-- courses: students see enrolled, parents see family-enrolled, admins see all
alter table app_public.courses enable row level security;
create policy select_enrolled on app_public.courses for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or id in (
      select course_id from app_public.enrollments
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );
create policy insert_admin on app_public.courses for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.courses for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.courses for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));
grant select, insert, update, delete on app_public.courses to :DATABASE_VISITOR;

-- modules: visible via enrolled course (own or family)
alter table app_public.modules enable row level security;
create policy select_via_course on app_public.modules for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or course_id in (
      select course_id from app_public.enrollments
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );
create policy insert_admin on app_public.modules for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.modules for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.modules for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));
grant select, insert, update, delete on app_public.modules to :DATABASE_VISITOR;

-- materials: global, enrolled course (own or family), or directly assigned (own or family)
alter table app_public.materials enable row level security;
create policy select_accessible on app_public.materials for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or is_global
    or id in (
      select mm.material_id from app_public.module_materials mm
      join app_public.modules m on m.id = mm.module_id
      join app_public.enrollments e on e.course_id = m.course_id
      where e.student_id = app_public.current_user_id()
        or e.student_id in (select app_public.current_user_family_member_ids())
    )
    or id in (
      select material_id from app_public.student_materials
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );
create policy insert_admin on app_public.materials for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.materials for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.materials for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));
grant select, insert, update, delete on app_public.materials to :DATABASE_VISITOR;

-- module_materials: visible via enrolled course (own or family)
alter table app_public.module_materials enable row level security;
create policy select_via_module on app_public.module_materials for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or module_id in (
      select m.id from app_public.modules m
      join app_public.enrollments e on e.course_id = m.course_id
      where e.student_id = app_public.current_user_id()
        or e.student_id in (select app_public.current_user_family_member_ids())
    )
  );
create policy insert_admin on app_public.module_materials for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.module_materials for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));
grant select, insert, delete on app_public.module_materials to :DATABASE_VISITOR;

-- enrollments: own, family, or admin
alter table app_public.enrollments enable row level security;
create policy select_own on app_public.enrollments for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );
create policy insert_admin on app_public.enrollments for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.enrollments for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));
grant select, insert, delete on app_public.enrollments to :DATABASE_VISITOR;

-- student_materials: own, family, or admin
alter table app_public.student_materials enable row level security;
create policy select_own on app_public.student_materials for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );
grant select, insert, update, delete on app_public.student_materials to :DATABASE_VISITOR;
