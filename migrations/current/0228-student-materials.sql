create table app_public.student_materials (
  student_id uuid not null references app_public.users(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (student_id, material_id)
);

alter table app_public.student_materials enable row level security;
grant select, insert, update, delete on app_public.student_materials to :DATABASE_VISITOR;

create policy select_admin on app_public.student_materials
  for select using (app_public.current_user_id() = student_id or app_public.current_user_role() in ('admin', 'teacher'));
create policy insert_admin on app_public.student_materials
  for insert with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.student_materials
  for update using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.student_materials
  for delete using (app_public.current_user_role() in ('admin', 'teacher'));

comment on table app_public.student_materials is 'Direct material assignments to individual students (not via course).';
