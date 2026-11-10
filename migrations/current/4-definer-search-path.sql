/*
 * SECURITY DEFINER functions end their search_path with pg_temp. Postgres
 * searches the session's temporary schema first for tables unless the path
 * names it last, and the visitor holds TEMP on the database, so a visitor
 * could create a temporary table that shadows a table the function body names.
 * These functions are defined in committed migrations, so they are altered
 * here; functions defined in current/ set the path where they are created.
 */
alter function app_private.tg__audit_record() set search_path to pg_catalog, pg_temp;
alter function app_private.tg_refunds__validate() set search_path to pg_catalog, pg_temp;
alter function app_private.tg_student_rates__record_history() set search_path to pg_catalog, pg_temp;
alter function app_public.enqueue_monthly_lesson_generation(uuid, date) set search_path to pg_catalog, pg_temp;
alter function app_public.issue_monthly_bills_for_month(date) set search_path to pg_catalog, pg_temp;
alter function app_public.monthly_occurrence_count(date, date, date, smallint) set search_path to pg_catalog, pg_temp;
