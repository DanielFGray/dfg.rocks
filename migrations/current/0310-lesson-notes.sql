-- Post-lesson notes from teacher to student.

-- ============================================================================
-- lesson_notes: teacher writes notes after each lesson
-- ============================================================================
create table app_public.lesson_notes (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references app_public.lessons(id) on delete cascade,
  topics_covered text,
  homework text,
  progress_observations text,
  notes text,
  material_ids uuid[],
  draft boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger _timestamps
  before insert or update on app_public.lesson_notes
  for each row execute function app_private.tg__timestamps();

-- Grants: read-only for visitors (teacher manages via PgRootDB)
grant select, insert, update, delete on app_public.lesson_notes to :DATABASE_VISITOR;

-- RLS
alter table app_public.lesson_notes enable row level security;

create policy select_own on app_public.lesson_notes for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or (
      draft = false
      and lesson_id in (
        select id from app_public.lessons
        where student_id = app_public.current_user_id()
          or student_id in (select app_public.current_user_family_member_ids())
      )
    )
  );

create policy insert_admin on app_public.lesson_notes for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.lesson_notes for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.lesson_notes for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

-- Comments
comment on table app_public.lesson_notes is 'Post-lesson notes from teacher to student. One per lesson, starts as draft until published.';
comment on column app_public.lesson_notes.lesson_id is 'The lesson these notes are for. Unique — one set of notes per lesson.';
comment on column app_public.lesson_notes.topics_covered is 'What was worked on during the lesson.';
comment on column app_public.lesson_notes.homework is 'What to practice before the next lesson.';
comment on column app_public.lesson_notes.progress_observations is 'How the student is progressing — strengths, areas to improve.';
comment on column app_public.lesson_notes.notes is 'Free-form additional notes.';
comment on column app_public.lesson_notes.material_ids is 'References to library materials attached to these notes.';
comment on column app_public.lesson_notes.draft is 'True while teacher is composing. Students only see published notes (draft = false).';
