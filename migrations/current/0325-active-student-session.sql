/*
 * Adds active_student_id to sessions so parent accounts can
 * remember which child they are currently acting on behalf of.
 * Null means "acting as self" or not applicable (admin/teacher/student).
 */

alter table app_private.sessions
  add column active_student_id uuid references app_public.users on delete set null;

comment on column app_private.sessions.active_student_id is
  E'When a parent selects a student from their family, this points to that student''s user ID. NULL means acting as self (or not a parent).';
