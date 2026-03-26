create table app_public.module_materials (
  module_id uuid not null references app_public.modules(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (module_id, material_id)
);

alter table app_public.module_materials enable row level security;
create policy select_via_module on app_public.module_materials for select
  using (
    app_public.current_user_role() = 'admin'
    or module_id in (
      select m.id from app_public.modules m
      join app_public.enrollments e on e.course_id = m.course_id
      where e.student_id = app_public.current_user_id()
        or e.student_id in (select app_public.current_user_family_member_ids())
    )
  );
grant select on app_public.module_materials to :DATABASE_VISITOR;

comment on table app_public.module_materials is 'Join table linking materials to course modules.';
