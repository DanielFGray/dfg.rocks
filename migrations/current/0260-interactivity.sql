-- Practice/completion tracking
create table app_public.practice_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  status text not null default 'practiced' check (status in ('practiced', 'completed')),
  notes text,
  logged_at timestamptz not null default now()
);

create index practice_logs_student_material on app_public.practice_logs(student_id, material_id);

-- Assignment notes
create table app_public.assignment_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index assignment_notes_student_material on app_public.assignment_notes(student_id, material_id);

-- Messaging
create table app_public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references app_public.users(id) on delete cascade,
  recipient_id uuid not null references app_public.users(id) on delete cascade,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index messages_recipient on app_public.messages(recipient_id, created_at desc);
create index messages_sender on app_public.messages(sender_id, created_at desc);

-- Constraints
alter table app_public.messages
  add constraint messages_body_length check (length(body) <= 10000);
alter table app_public.assignment_notes
  add constraint assignment_notes_body_length check (length(body) <= 50000);

-- Column-level grants
grant insert (student_id, material_id, status, notes) on app_public.practice_logs to :DATABASE_VISITOR;
grant insert (student_id, material_id, body) on app_public.assignment_notes to :DATABASE_VISITOR;
grant update (body) on app_public.assignment_notes to :DATABASE_VISITOR;
grant insert (sender_id, recipient_id, body) on app_public.messages to :DATABASE_VISITOR;
grant update (is_read) on app_public.messages to :DATABASE_VISITOR;

-- Comments
comment on table app_public.practice_logs is 'Student practice/completion tracking per material.';
comment on table app_public.assignment_notes is 'Per-student notes on assigned materials (one per student+material).';
comment on table app_public.messages is 'Direct messages between users (admin<->student communication).';
