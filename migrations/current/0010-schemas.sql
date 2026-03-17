drop schema if exists app_public cascade;
drop schema if exists app_private cascade;

create schema app_public;
create schema app_private;
grant usage on schema app_public to :DATABASE_VISITOR;

create function app_private.tg__timestamps() returns trigger as $$
begin
  new.created_at = (case when tg_op = 'INSERT' then now() else old.created_at end);
  new.updated_at = now();
  return new;
end;
$$ language plpgsql volatile;

create type app_public.user_role as enum ('admin', 'student');

create function app_public.current_user_id() returns uuid as $$
  select nullif(current_setting('my.user_id', true), '')::uuid;
$$ language sql stable;

create function app_public.current_user_role() returns text as $$
  select current_setting('my.user_role', true);
$$ language sql stable;
