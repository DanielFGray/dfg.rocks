/*
 * An admin sets any account's role. The visitor may update only a user's profile columns
 * (username, name, bio, avatar_url), so the role change runs here, as the function owner.
 *
 * Refusals, in the order they are checked:
 *   - the caller is not an admin (DNIED)
 *   - the caller names its own account (DNIED): an admin cannot change their own role
 *
 * The last admin cannot be demoted, and no separate check is needed for it. Every call takes
 * the admin-row lock before it reads the caller's role. A call that waits on another call's
 * lock therefore reads the caller's role after that call commits, so the caller is still an
 * admin when the change runs. The caller is never the target, so each committed change leaves
 * its caller an admin.
 *
 * This argument needs READ COMMITTED, where each statement sees the data committed before it
 * starts. Under REPEATABLE READ the waiting call fails with a serialization error instead, which
 * is also a refusal.
 *
 * A parent who is the billing contact of a family with students is refused by the deferred
 * trigger in 2-family-billing-contact.sql, at commit, so this function does not repeat that rule.
 *
 * Reruns safely: `graphile-migrate watch` applies this file after each edit, and the release
 * commit applies it again on a database that already has it.
 */

create or replace function app_public.set_user_role(p_user_id uuid, p_role app_public.user_role)
returns app_public.users as $$
declare
  v_user app_public.users;
begin
  -- Lock first, in id order. A concurrent call waits here; once it commits, the lock re-checks
  -- `role = 'admin'`, so the role checks below run on the committed state. Each check takes a
  -- fresh snapshot, because each statement does.
  perform 1 from app_public.users where role = 'admin' order by id for update;

  if app_public.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change a role' using errcode = 'DNIED';
  end if;

  if p_user_id = app_public.current_user_id() then
    raise exception 'You cannot change your own role' using errcode = 'DNIED';
  end if;

  update app_public.users set role = p_role where id = p_user_id returning * into v_user;
  if not found then
    raise exception 'User not found' using errcode = 'NTFND';
  end if;
  return v_user;
end;
$$ language plpgsql volatile security definer set search_path = pg_catalog, pg_temp;

grant execute on function app_public.set_user_role(uuid, app_public.user_role) to :DATABASE_VISITOR;
