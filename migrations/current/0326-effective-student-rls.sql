/*
 * Effective student resolution for parent accounts.
 *
 * When a parent session has active_student_id set, the parent acts
 * on behalf of that student. current_effective_user_id() returns the
 * student's ID in that case, or the session user's ID otherwise.
 *
 * Writes (practice_logs, assignment_progress, assignment_reviews,
 * assignment_notes, messages, lessons) are updated to allow parents
 * to act as their active student.
 */

create function app_public.current_effective_user_id() returns uuid as $$
  select coalesce(
    (select s.active_student_id
       from app_private.sessions s
       join app_public.users u on u.id = s.user_id
      where s.id = app_public.current_session_id()
        and u.role = 'parent'
        and s.active_student_id is not null
        and s.active_student_id in (select app_public.current_user_family_member_ids())),
    app_public.current_user_id()
  );
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.current_effective_user_id() is
  E'Returns the active student ID when the session user is a parent with an active student; falls back to the session user ID otherwise.';

-- extend the is-acting-for-family-student check to a reusable helper
create function app_public.is_acting_for_family_student(student_id uuid) returns boolean as $$
  select app_public.current_user_role() in ('admin', 'teacher')
      or student_id = app_public.current_effective_user_id();
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.is_acting_for_family_student(uuid) is
  E'Returns true when the caller (or their effective student) owns the given student_id.';

create function app_public.can_book_for_family_student(student_id uuid) returns boolean as $$
  select app_public.current_user_role() in ('admin', 'teacher')
      or student_id = app_public.current_user_id()
      or student_id in (select app_public.current_user_family_member_ids());
$$ language sql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.can_book_for_family_student(uuid) is
  E'Returns true when the caller may book a lesson for the given student, including parents booking for family students.';

-- ============================================================================
-- practice_logs: replace student-only insert with effective-student-aware
-- ============================================================================
drop policy if exists insert_own on app_public.practice_logs;

create policy insert_own on app_public.practice_logs for insert
  with check (app_public.is_acting_for_family_student(student_id));

drop policy if exists update_own on app_public.practice_logs;

create policy update_own on app_public.practice_logs for update
  using (app_public.is_acting_for_family_student(student_id));

-- ============================================================================
-- assignment_progress: insert/update now effective-student-aware
-- ============================================================================
drop policy if exists insert_own on app_public.assignment_progress;
drop policy if exists update_own on app_public.assignment_progress;

create policy insert_own on app_public.assignment_progress for insert
  with check (app_public.is_acting_for_family_student(student_id));

create policy update_own on app_public.assignment_progress for update
  using (app_public.is_acting_for_family_student(student_id));

-- ============================================================================
-- assignment_reviews: insert now effective-student-aware
-- ============================================================================
drop policy if exists insert_own on app_public.assignment_reviews;

create policy insert_own on app_public.assignment_reviews for insert
  with check (app_public.is_acting_for_family_student(student_id));

-- ============================================================================
-- assignment_notes: insert/update now effective-student-aware
-- ============================================================================
drop policy if exists insert_own on app_public.assignment_notes;
drop policy if exists update_own on app_public.assignment_notes;

create policy insert_own on app_public.assignment_notes for insert
  with check (app_public.is_acting_for_family_student(student_id));

create policy update_own on app_public.assignment_notes for update
  using (app_public.is_acting_for_family_student(student_id));

-- ============================================================================
-- messages: allow parent to send as effective student
-- ============================================================================
drop policy if exists insert_sender on app_public.messages;

create policy insert_sender on app_public.messages for insert
  with check (app_public.is_acting_for_family_student(sender_id));

-- ============================================================================
-- lessons: allow parents acting for a family student to book lessons
-- ============================================================================
drop policy if exists insert_family on app_public.lessons;

create policy insert_family on app_public.lessons for insert
  with check (app_public.can_book_for_family_student(student_id));

-- Also need insert grant for lessons (only select was granted initially)
grant insert on app_public.lessons to :DATABASE_VISITOR;

drop policy if exists insert_family on app_public.lesson_deposits;

create policy insert_family on app_public.lesson_deposits for insert
  with check (
    lesson_id in (
      select id from app_public.lessons
      where app_public.can_book_for_family_student(student_id)
    )
  );
