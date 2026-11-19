--! Previous: sha1:98f993b17e8d87c7d2ae1034e5559d8c9b4f5d92
--! Hash: sha1:21be104abd1be1368ed34f0a4fdcfdb648636604

--! split: 1-current.sql
-- Enter migration here

--! split: 8-public-course-anonymous.sql
/*
 * A public course is readable by anyone, with no account: a visitor whose request carries no
 * session reads the course, its modules, its module_materials and its public materials.
 * 'global' still needs an admitted account and 'course' an enrollment, a schedule or a
 * subscription. can_read_course stays the one rule; the materials policy follows it.
 *
 * Every statement reruns safely (create or replace, drop policy if exists).
 */

create or replace function app_public.can_read_course(
  p_course_id uuid,
  p_reader_id uuid default app_public.current_user_id()
) returns boolean as $$
  with
  -- The learners a reader sees: the reader, and when the reader is a parent, the students in
  -- every family the parent belongs to. A sibling is not a learner of the reader's enrollment.
  learners as (
    select p_reader_id as user_id
    union
    select fm2.user_id
      from app_public.family_memberships fm1
      join app_public.family_memberships fm2 on fm2.family_id = fm1.family_id
      join app_public.users u on u.id = fm2.user_id
     where fm1.user_id = p_reader_id
       and u.role = 'student'
       and exists (
         select 1 from app_public.users r where r.id = p_reader_id and r.role = 'parent'
       )
  ),
  payers as (
    select p.user_id from app_public.family_payers(p_reader_id) as p(user_id)
  )
  select
    -- A public course is readable by anyone, a visitor with no account included. Its answer
    -- names no reader, so it is the same whoever asks about whom. ("and" binds tighter than
    -- "or": everything after this first branch is one branch.)
    exists (
      select 1 from app_public.courses c where c.id = p_course_id and c.visibility = 'public'
    )
    or
    -- Another user's access is reported only to staff and to members of a family the reader
    -- belongs to, so an unrelated account cannot probe it. A visitor with no account has no
    -- reader id, so nothing below applies to it.
    (p_reader_id = app_public.current_user_id()
     or app_public.current_user_role() in ('admin', 'teacher')
     or p_reader_id in (
       select fm.user_id
         from app_public.family_memberships fm
        where fm.family_id in (select app_public.current_user_member_family_ids())
     ))
    and (
      exists (
        select 1 from app_public.users u
         where u.id = p_reader_id and u.role in ('admin', 'teacher')
      )
      -- The course's own level: global needs an admitted account.
      or exists (
        select 1
          from app_public.courses c
          join app_public.users u on u.id = p_reader_id
         where c.id = p_course_id
           and c.visibility = 'global' and u.role is not null
      )
      or exists (
        select 1
          from app_public.enrollments e
         where e.course_id = p_course_id
           and e.student_id in (select user_id from learners)
      )
      or exists (
        select 1
          from app_public.recurring_schedules rs
          join app_public.student_rates sr on sr.id = rs.student_rate_id
         where rs.active
           and rs.starts_on <= (now() at time zone rs.timezone)::date
           and (rs.ends_on is null or rs.ends_on >= (now() at time zone rs.timezone)::date)
           and sr.student_id in (select user_id from learners)
      )
      or exists (
        select 1
          from app_public.subscriptions s
         where s.payer_id in (select user_id from payers)
           and app_public.subscription_is_live(s.status, s.current_period_end)
      )
    );
$$ language sql stable security definer set search_path to pg_catalog, pg_temp;

comment on function app_public.can_read_course(uuid, uuid) is
  E'Whether a reader may read a course and its content. The reader defaults to the current user. True for staff; for anyone, a visitor with no account included, when the course is public; for an admitted reader (role not null) when it is global; for a reader who is enrolled in the course, or who has an active weekly lesson schedule, where a parent reader counts the schedules and enrollments of the students in their families (any course); or who or whose billing contacts have a live subscription (any course). past_due keeps access while Stripe retries the card. A reader other than the current user is reported only to staff and to members of a family the reader belongs to; otherwise the answer is false. The course-access policies all call this function, so changing who may read a course changes it here.';

comment on type app_public.content_visibility is
  E'Who may read a course or a material: public (anyone, signed in or not), global (an account with a role), course (only through enrollment, a module or an assignment).';

-- A public material is readable by anyone; the other branches are as before.
drop policy if exists select_accessible on app_public.materials;
create policy select_accessible on app_public.materials for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or visibility = 'public'
    or (visibility = 'global' and app_public.current_user_role() is not null)
    or id in (
      select mm.material_id
        from app_public.module_materials mm
        join app_public.modules m on m.id = mm.module_id
       where app_public.can_read_course(m.course_id)
    )
    or id in (
      select material_id from app_public.student_materials
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );
