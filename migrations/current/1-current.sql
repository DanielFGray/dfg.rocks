-- Enter migration here
drop policy if exists select_admin on app_public.families;
create policy select_admin on app_public.families
  for select using (app_public.current_user_role() in ('admin', 'teacher'));
