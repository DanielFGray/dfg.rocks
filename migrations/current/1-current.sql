-- One row per saved click-track listening take: how closely a student played to the click.

create table if not exists app_public.practice_takes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  taken_at timestamptz not null default now(),
  bpm double precision not null check (bpm > 0),
  subdivision integer not null check (subdivision > 0),
  notes_heard integer not null check (notes_heard >= 0),
  on_time_pct double precision not null check (on_time_pct between 0 and 100),
  mean_offset_ms double precision not null,
  spread_ms double precision not null check (spread_ms >= 0)
);

create index if not exists practice_takes_student_material
  on app_public.practice_takes(student_id, material_id, taken_at);

comment on table app_public.practice_takes is
  'A saved Listen take: timing of the notes a student played against the click. mean_offset_ms is negative when early, positive when late; spread_ms is the standard deviation of the offsets.';

alter table app_public.practice_takes enable row level security;

grant select on app_public.practice_takes to :DATABASE_VISITOR;
grant insert (student_id, material_id, taken_at, bpm, subdivision, notes_heard, on_time_pct, mean_offset_ms, spread_ms)
  on app_public.practice_takes to :DATABASE_VISITOR;

-- Read rule matches practice_logs select_own: the student, their family members, teachers and admins.
drop policy if exists select_own on app_public.practice_takes;
create policy select_own on app_public.practice_takes for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

-- Only the student saves a take, and only for themself.
drop policy if exists insert_own on app_public.practice_takes;
create policy insert_own on app_public.practice_takes for insert
  with check (student_id = app_public.current_user_id());
