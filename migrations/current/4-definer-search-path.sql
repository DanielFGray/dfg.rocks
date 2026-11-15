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
