-- RLS policies for interactivity tables (practice_logs, assignment_notes, messages)
-- Parents get read-only visibility into family students' data.

-- ============================================================================
-- practice_logs: own, family, or admin (insert: own only, update: own only)
-- ============================================================================
alter table app_public.practice_logs enable row level security;

create policy select_own on app_public.practice_logs for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_own on app_public.practice_logs for insert
  with check (student_id = app_public.current_user_id());

create policy insert_admin on app_public.practice_logs for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

create policy update_own on app_public.practice_logs for update
  using (student_id = app_public.current_user_id());

grant select, insert, update on app_public.practice_logs to :DATABASE_VISITOR;

-- ============================================================================
-- assignment_notes: own, family, or admin (insert/update: own only)
-- ============================================================================
alter table app_public.assignment_notes enable row level security;

create policy select_own on app_public.assignment_notes for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_own on app_public.assignment_notes for insert
  with check (student_id = app_public.current_user_id());

create policy update_own on app_public.assignment_notes for update
  using (student_id = app_public.current_user_id());

create policy insert_admin on app_public.assignment_notes for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.assignment_notes for update
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update on app_public.assignment_notes to :DATABASE_VISITOR;

-- ============================================================================
-- messages: sender/recipient, family, or admin
-- Parents can see messages sent to/from their family's students.
-- Insert/update: still only sender/recipient respectively.
-- ============================================================================
alter table app_public.messages enable row level security;

create policy select_own on app_public.messages for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or sender_id = app_public.current_user_id()
    or recipient_id = app_public.current_user_id()
    or sender_id in (select app_public.current_user_family_member_ids())
    or recipient_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_sender on app_public.messages for insert
  with check (sender_id = app_public.current_user_id());

create policy update_recipient on app_public.messages for update
  using (recipient_id = app_public.current_user_id());

create policy insert_admin on app_public.messages for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.messages for update
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update on app_public.messages to :DATABASE_VISITOR;
