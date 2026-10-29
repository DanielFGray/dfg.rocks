begin;

-- Extensions come from cartridge.json through `ops dev db`, not from this file.

grant all on database :DATABASE_NAME to :DATABASE_OWNER;

-- `graphile-migrate reset` revokes connect from public. A NOINHERIT login that is a member of the
-- visitor role does not inherit the visitor's connect, so grant connect to each member directly.
do $$
declare
  login_role name;
begin
  for login_role in
    select pg_get_userbyid(member) from pg_auth_members where roleid = ':DATABASE_VISITOR'::regrole
  loop
    execute format('grant connect on database %I to %I', current_database(), login_role);
  end loop;
end $$;

alter schema public owner to :DATABASE_OWNER;

commit;
