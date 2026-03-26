create table app_public.student_materials (
  student_id uuid not null references app_public.users(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (student_id, material_id)
);

alter table app_public.student_materials enable row level security;

create policy select_own on app_public.student_materials for select
  using (
    app_public.current_user_role() = 'admin'
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );
grant select, insert, delete on app_public.student_materials to :DATABASE_VISITOR;

comment on table app_public.student_materials is 'Direct material assignments to individual students (not via course).';
