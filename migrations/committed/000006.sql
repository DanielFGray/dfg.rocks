--! Previous: sha1:7c36b829228ec23b21df37ecd1a77e373ef87eed
--! Hash: sha1:fdf313e8b6092c712606d1606fd99fad999dceec

--! split: 1-current.sql
-- Enter migration here

--! split: 2-access.sql
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

--! split: 3-reset-token-age.sql
/*
 * reset_password refuses a token older than its lifetime. Before, it used
 * v_token_max_duration only for the failed-attempt window, so an emailed reset
 * token stayed valid until it was used. The age test uses the same boundary as
 * forgot_password, so a token is refused exactly when a new one would be
 * issued. An expired token counts as a failed attempt, like a wrong one.
 */
create or replace function app_private.reset_password(user_id uuid, reset_token text, new_password text) returns app_private.sessions as $$
declare
  v_user app_public.users;
  v_user_secret app_private.user_secrets;
  v_token_max_duration interval = interval '3 days';
  v_session app_private.sessions;
begin
  select users.* into v_user
  from app_public.users
  where id = user_id;

  if v_user is null then
    return null;
  end if;

  -- Load their secrets
  select * into v_user_secret from app_private.user_secrets
  where user_secrets.user_id = v_user.id;

  -- Have there been too many reset attempts?
  if (
    v_user_secret.first_failed_reset_password_attempt is not null
  and
    v_user_secret.first_failed_reset_password_attempt > NOW() - v_token_max_duration
  and
    v_user_secret.failed_reset_password_attempts >= 20
  ) then
    raise exception 'Password reset locked - too many reset attempts' using errcode = 'LOCKD';
  end if;

  -- Not too many reset attempts, let's check the token
  if v_user_secret.reset_password_token is null
     or v_user_secret.reset_password_token is distinct from reset_token
     or v_user_secret.reset_password_token_generated is null
     or v_user_secret.reset_password_token_generated < now() - v_token_max_duration then
    -- Wrong or expired token, bump all the attempt tracking figures
    update app_private.user_secrets
    set
      failed_reset_password_attempts = (case when first_failed_reset_password_attempt is null or first_failed_reset_password_attempt < now() - v_token_max_duration then 1 else failed_reset_password_attempts + 1 end),
      first_failed_reset_password_attempt = (case when first_failed_reset_password_attempt is null or first_failed_reset_password_attempt < now() - v_token_max_duration then now() else first_failed_reset_password_attempt end)
    where user_secrets.user_id = v_user.id;
    return null;
  end if;

  -- Excellent - they're legit
  -- perform app_private.assert_valid_password(new_password);

  -- Let's reset the password as requested
  update app_private.user_secrets
  set
    password_hash = crypt(new_password, gen_salt('bf')),
    failed_password_attempts = 0,
    first_failed_password_attempt = null,
    reset_password_token = null,
    reset_password_token_generated = null,
    failed_reset_password_attempts = 0,
    first_failed_reset_password_attempt = null
  where user_secrets.user_id = v_user.id;

  -- Revoke the users' sessions
  delete from app_private.sessions
  where sessions.user_id = v_user.id;

  -- Notify user their password was reset
  perform graphile_worker.add_job(
    'user__audit',
    json_build_object(
      'type', 'reset_password',
      'user_id', v_user.id,
      'current_user_id', app_public.current_user_id()
    ));

  -- Create a new session for the user
  insert into app_private.sessions (user_id) values (v_user.id) returning * into v_session;
  return v_session;
end;
$$ language plpgsql strict volatile;

--! split: 4-definer-search-path.sql
/*
 * SECURITY DEFINER functions end their search_path with pg_temp. Postgres
 * searches the session's temporary schema first for tables unless the path
 * names it last, and the visitor holds TEMP on the database, so a visitor
 * could create a temporary table that shadows a table the function body names.
 * These functions are defined in committed migrations, so they are altered
 * here; functions defined in current/ set the path where they are created.
 */
alter function app_private.assert_student_in_one_family(p_user_id uuid) set search_path to pg_catalog, pg_temp;
alter function app_private.join_family(p_family_id uuid, p_user_id uuid) set search_path to pg_catalog, pg_temp;
alter function app_private.tg__audit_record() set search_path to pg_catalog, pg_temp;
alter function app_private.tg_credit_applications__consume() set search_path to pg_catalog, pg_temp;
alter function app_private.tg_credit_applications__validate() set search_path to pg_catalog, pg_temp;
alter function app_private.tg_family_memberships__one_family_per_student() set search_path to pg_catalog, pg_temp;
alter function app_private.tg_lessons__sync_calendar_event() set search_path to pg_catalog, pg_temp;
alter function app_private.tg_payment_allocations__validate() set search_path to pg_catalog, pg_temp;
alter function app_private.tg_refunds__validate() set search_path to pg_catalog, pg_temp;
alter function app_private.tg_student_rates__record_history() set search_path to pg_catalog, pg_temp;
alter function app_private.tg_users__one_family_per_student() set search_path to pg_catalog, pg_temp;
alter function app_public.create_monthly_bill_line_items(p_bill_id uuid, p_student_id uuid, p_billing_month date, p_due_date date) set search_path to pg_catalog, pg_temp;
alter function app_public.create_single_booking_obligation(p_lesson_id uuid) set search_path to pg_catalog, pg_temp;
alter function app_public.current_user_visible_payer_ids() set search_path to pg_catalog, pg_temp;
alter function app_public.enqueue_monthly_lesson_generation(p_student_id uuid, p_billing_month date) set search_path to pg_catalog, pg_temp;
alter function app_public.get_effective_discount(p_payer_id uuid, p_on_date date) set search_path to pg_catalog, pg_temp;
alter function app_public.get_effective_tax_rate(p_payer_id uuid, p_on_date date) set search_path to pg_catalog, pg_temp;
alter function app_public.issue_monthly_bills(p_billing_month date) set search_path to pg_catalog, pg_temp;
alter function app_public.issue_monthly_bills_for_month(p_billing_month date) set search_path to pg_catalog, pg_temp;
alter function app_public.monthly_billing_eligible(p_billing_month date) set search_path to pg_catalog, pg_temp;
alter function app_public.monthly_occurrence_count(p_starts_on date, p_ends_on date, p_billing_month date, p_day_of_week smallint) set search_path to pg_catalog, pg_temp;
alter function app_public.next_bill_number() set search_path to pg_catalog, pg_temp;
alter function app_public.next_payment_number() set search_path to pg_catalog, pg_temp;
alter function app_public.payer_id_for_student(p_student_id uuid) set search_path to pg_catalog, pg_temp;
alter function app_public.settle_single_booking_cancellation(p_lesson_id uuid, p_captured_deposit_cents integer) set search_path to pg_catalog, pg_temp;
