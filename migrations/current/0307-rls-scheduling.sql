-- RLS policies for scheduling tables (student_rates, lessons, lesson_deposits)
-- Admin manages all via PgRootDB. Students see own, parents see family.

-- ============================================================================
-- student_rates: own, family, or admin
-- ============================================================================
alter table app_public.student_rates enable row level security;

create policy select_own on app_public.student_rates for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_admin on app_public.student_rates for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.student_rates for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.student_rates for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update, delete on app_public.student_rates to :DATABASE_VISITOR;

-- ============================================================================
-- lessons: own, family, or admin
-- ============================================================================
alter table app_public.lessons enable row level security;

create policy select_own on app_public.lessons for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_admin on app_public.lessons for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.lessons for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.lessons for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update, delete on app_public.lessons to :DATABASE_VISITOR;

-- ============================================================================
-- lesson_deposits: own (via lesson), family (via lesson), or admin
-- ============================================================================
alter table app_public.lesson_deposits enable row level security;

create policy select_own on app_public.lesson_deposits for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or lesson_id in (
      select id from app_public.lessons
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );

create policy insert_admin on app_public.lesson_deposits for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.lesson_deposits for update
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update on app_public.lesson_deposits to :DATABASE_VISITOR;
