create table app_public.practice_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  status text not null default 'practiced' check (status in ('practiced', 'completed')),
  notes text,
  logged_at timestamptz not null default now()
);

create index practice_logs_student_material on app_public.practice_logs(student_id, material_id);

alter table app_public.practice_logs enable row level security;

create policy select_own on app_public.practice_logs for select
  using (
    app_public.current_user_role() = 'admin'
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_own on app_public.practice_logs for insert
  with check (student_id = app_public.current_user_id());

grant select, insert on app_public.practice_logs to :DATABASE_VISITOR;
grant insert (student_id, material_id, status, notes) on app_public.practice_logs to :DATABASE_VISITOR;

comment on table app_public.practice_logs is 'Student practice/completion tracking per material.';
