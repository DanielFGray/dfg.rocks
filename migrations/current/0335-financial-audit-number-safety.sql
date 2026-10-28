-- Financial audit history + document number safety.
--
-- 1. Populate financial_audit_events via SECURITY DEFINER triggers on all
--    core financial tables. Audit rows are append-only (immutable trigger).
-- 2. Replace transactional per-family counters with non-transactional global
--    sequences so document numbers are consumed even when the ledger
--    transaction rolls back. Gaps are expected and acceptable.

-- ============================================================================
-- 1. Document number safety — non-transactional global sequences
-- ============================================================================
-- PostgreSQL sequences are non-transactional: nextval() advances the counter
-- and that advancement is never rolled back. This guarantees that a consumed
-- bill or payment number is never reused after a failed transaction.
--
-- We preserve the (family_id, bill_number) UNIQUE constraint — since sequence
-- values are globally unique across all families, no two records can share the
-- same (family_id, bill_number) pair within a family.
--
-- PostgreSQL sequences are non-transactional, so failed ledger transactions
-- consume numbers and leave gaps rather than reusing them. Numbers are global
-- identifiers; the existing family-local uniqueness constraints remain intact.

comment on column app_public.bills.bill_number is
  'Globally sequential document identifier. Allocation is non-transactional and may contain gaps.';
comment on column app_public.payments.payment_number is
  'Globally sequential receipt identifier. Allocation is non-transactional and may contain gaps.';

create sequence if not exists app_public.bill_number_seq as integer
  minvalue 1 no maxvalue no cycle;

create sequence if not exists app_public.payment_number_seq as integer
  minvalue 1 no maxvalue no cycle;

do $$ begin
  perform setval(
    'app_public.bill_number_seq',
    (select coalesce(max(bill_number), 0) + 1 from app_public.bills),
    false
  );
  perform setval(
    'app_public.payment_number_seq',
    (select coalesce(max(payment_number), 0) + 1 from app_public.payments),
    false
  );
end $$;

create or replace function app_public.next_bill_number(p_family_id uuid)
returns integer
language plpgsql volatile security definer set search_path to pg_catalog as $$
begin
  return nextval('app_public.bill_number_seq')::integer;
end;
$$;

create or replace function app_public.next_payment_number(p_family_id uuid)
returns integer
language plpgsql volatile security definer set search_path to pg_catalog as $$
begin
  return nextval('app_public.payment_number_seq')::integer;
end;
$$;

comment on function app_public.next_bill_number(uuid) is
  'Returns the next globally unique bill number. Allocation is irrevocable and non-transactional; gaps may occur.';

comment on function app_public.next_payment_number(uuid) is
  'Returns the next globally unique payment number. Allocation is irrevocable and non-transactional; gaps may occur.';

-- ============================================================================
-- 2. Financial audit trigger function (SECURITY DEFINER)
-- ============================================================================
-- Records every INSERT/UPDATE/DELETE on core financial tables. Runs as the
-- function owner (database owner) so it bypasses RLS and always succeeds.
-- actor_id is resolved from the session context; null for background workers.

create or replace function app_private.tg__audit_record() returns trigger
  security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_actor_id  uuid;
  v_table     text;
  v_record_id uuid;
begin
  v_actor_id := app_public.current_user_id();
  v_table    := TG_TABLE_NAME;

  if TG_OP in ('UPDATE', 'DELETE') then
    v_record_id := OLD.id;
  else
    v_record_id := NEW.id;
  end if;

  insert into app_public.financial_audit_events
    (actor_id, action, table_name, record_id, old_values, new_values)
  values (
    v_actor_id,
    lower(TG_OP),
    v_table,
    v_record_id,
    case when TG_OP in ('DELETE', 'UPDATE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end
  );

  return coalesce(NEW, OLD);
end;
$$;

comment on function app_private.tg__audit_record() is
  'SECURITY DEFINER trigger function that records financial DML in financial_audit_events. Attach via AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.';

-- ============================================================================
-- 3. Immutable trigger for financial_audit_events
-- ============================================================================
-- Prevents even the database owner from altering or deleting audit rows.
-- Without this, RLS allows admin INSERT — but UPDATE/DELETE have no policies
-- (implicitly denied by RLS for non-owner). The trigger catches owner-level
-- modifications that bypass RLS.

create or replace function app_private.tg_financial_audit__immutable()
returns trigger
  language plpgsql as $$
begin
  raise exception 'financial_audit_events are append-only; modification is not permitted';
end;
$$;

create trigger _immutable
  before update or delete on app_public.financial_audit_events
  for each row execute function app_private.tg_financial_audit__immutable();

-- ============================================================================
-- 4. Audit triggers — all 10 core financial tables
-- ============================================================================
-- Each trigger fires AFTER the DML so the audit record captures the committed
-- state. The trigger function is SECURITY DEFINER so it can insert into
-- financial_audit_events regardless of the calling user's RLS permissions.

-- 4a. bills
create trigger _audit
  after insert or update or delete on app_public.bills
  for each row execute function app_private.tg__audit_record();

-- 4b. bill_line_items
create trigger _audit
  after insert or update or delete on app_public.bill_line_items
  for each row execute function app_private.tg__audit_record();

-- 4c. payments
create trigger _audit
  after insert or update or delete on app_public.payments
  for each row execute function app_private.tg__audit_record();

-- 4d. payment_allocations
create trigger _audit
  after insert or update or delete on app_public.payment_allocations
  for each row execute function app_private.tg__audit_record();

-- 4e. family_credits
create trigger _audit
  after insert or update or delete on app_public.family_credits
  for each row execute function app_private.tg__audit_record();

-- 4f. refunds
create trigger _audit
  after insert or update or delete on app_public.refunds
  for each row execute function app_private.tg__audit_record();

-- 4g. bill_adjustments
create trigger _audit
  after insert or update or delete on app_public.bill_adjustments
  for each row execute function app_private.tg__audit_record();

-- 4h. family_discounts
create trigger _audit
  after insert or update or delete on app_public.family_discounts
  for each row execute function app_private.tg__audit_record();

-- 4i. tax_rates
create trigger _audit
  after insert or update or delete on app_public.tax_rates
  for each row execute function app_private.tg__audit_record();

-- 4j. family_tax_exemptions
create trigger _audit
  after insert or update or delete on app_public.family_tax_exemptions
  for each row execute function app_private.tg__audit_record();

-- ============================================================================
-- 5. RLS for financial_audit_events — append-only
-- ============================================================================
-- The existing RLS policies (from 0330/0331) already allow SELECT and INSERT
-- for admin only. No UPDATE/DELETE policies exist, so RLS implicitly denies
-- those operations for all non-owner roles. The immutable trigger above
-- catches owner-level modifications.
--
-- We add explicit REVOKE for UPDATE/DELETE on the audit table so even direct
-- SQL by the visitor role is prevented at the permission layer (in addition
-- to RLS denial and the immutable trigger).

-- No explicit REVOKE needed: RLS already denies UPDATE/DELETE (no policies
-- exist for those operations). The immutable trigger above catches
-- owner-level modifications that bypass RLS.
--
-- The default privilege grant in 0020-schemas.sql grants USAGE on all
-- app_public sequences to :DATABASE_VISITOR. These new sequences are in
-- app_public so the default privilege covers them automatically.
