create table app_public.assignment_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index assignment_notes_student_material on app_public.assignment_notes(student_id, material_id);

alter table app_public.assignment_notes enable row level security;

create policy select_own on app_public.assignment_notes for select
  using (
    app_public.current_user_role() = 'admin'
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_own on app_public.assignment_notes for insert
  with check (student_id = app_public.current_user_id());

create policy update_own on app_public.assignment_notes for update
  using (student_id = app_public.current_user_id());

grant select,
  insert (student_id, material_id, body),
  update (body) on app_public.assignment_notes to :DATABASE_VISITOR;

alter table app_public.assignment_notes
  add constraint assignment_notes_body_length check (length(body) <= 50000);

comment on table app_public.assignment_notes is 'Per-student notes on assigned materials (one per student+material).';
