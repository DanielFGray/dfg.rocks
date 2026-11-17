/*
 * Staff (admin and teacher) read every family's memberships, so the person page can show a
 * person's families to a teacher. The policy keeps its name and its one clause; only the role
 * list changes. Member and invited readers keep their own policies (select_member,
 * select_invited) and see only their families.
 *
 * Reruns safely: `graphile-migrate watch` applies this file after each edit, and the release
 * commit applies it again on a database that already has it.
 */

drop policy if exists select_admin on app_public.family_memberships;
create policy select_admin on app_public.family_memberships for select using (
  app_public.current_user_role() in ('admin', 'teacher')
);
