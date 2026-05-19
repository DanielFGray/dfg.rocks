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

grant select,
  insert (student_id, material_id, body),
  update (body) on app_public.assignment_notes to :DATABASE_VISITOR;

alter table app_public.assignment_notes
  add constraint assignment_notes_body_length check (length(body) <= 50000);

comment on table app_public.assignment_notes is 'Per-student notes on assigned materials (one per student+material).';
