--! Previous: sha1:ef6571e4102a5c0cb4d3a2739f8c8b735e408434
--! Hash: sha1:e8701e7df6f026639eea1d4f3e85e6d4be20e4b3

--! split: 1-current.sql
-- Enter migration here
drop policy if exists select_admin on app_public.families;
create policy select_admin on app_public.families
  for select using (app_public.current_user_role() in ('admin', 'teacher'));
