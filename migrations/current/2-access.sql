/*
 * Limit what any signed-in account can reach.
 *
 * Anyone can sign in with Google or Apple and get an account with no family,
 * no rate and no enrollment. Such an account must not see other people, message
 * them, book lessons, or create families.
 */

-- Users ---------------------------------------------------------------------

-- Staff rows stay visible to everyone: a non-staff user messages staff, and the
-- message service finds the default recipient by reading users under RLS.
drop policy if exists select_all on app_public.users;
drop policy if exists select_visible on app_public.users;
create policy select_visible on app_public.users for select
  using (
    id = app_public.current_user_id()
    or role in ('admin', 'teacher')
    or id in (select app_public.current_user_family_member_ids())
    or app_public.current_user_role() in ('admin', 'teacher')
  );

-- Messages ------------------------------------------------------------------

-- A non-staff user, or a parent acting for a family student, may message only
-- staff. Staff send through insert_admin.
drop policy if exists insert_sender on app_public.messages;
create policy insert_sender on app_public.messages for insert
  with check (
    app_public.is_acting_for_family_student(sender_id)
    and exists (
      select 1 from app_public.users
       where users.id = recipient_id
         and users.role in ('admin', 'teacher')
    )
  );

-- Lessons -------------------------------------------------------------------

-- A student or parent may book only at a location the teacher has priced for
-- that student.
drop policy if exists insert_family on app_public.lessons;
create policy insert_family on app_public.lessons for insert
  with check (
    app_public.can_book_for_family_student(student_id)
    and exists (
      select 1 from app_public.student_rates
       where student_rates.student_id = lessons.student_id
         and student_rates.location_type = lessons.location_type
    )
  );

-- Families ------------------------------------------------------------------

-- Family membership is what lets a user call create_child and invite_to_family,
-- so only staff may create a family.
create or replace function app_public.create_family(slug citext, name text) returns app_public.families as $$
declare
  v_org app_public.families;
begin
  if app_public.current_user_role() is distinct from 'admin'
     and app_public.current_user_role() is distinct from 'teacher' then
    raise exception 'Only staff can create a family' using errcode = 'DNIED';
  end if;
  insert into app_public.families (slug, name) values (slug, name) returning * into v_org;
  insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
    values(v_org.id, app_public.current_user_id(), true, true);
  return v_org;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, public, pg_temp;
