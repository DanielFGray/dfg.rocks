-- Enforce ledger relationships at the database boundary.

create or replace function app_private.tg_payment_allocations__validate()
returns trigger
security definer
set search_path to pg_catalog
language plpgsql as $$
declare
  v_payment_family uuid;
  v_payment_amount integer;
  v_bill_family uuid;
  v_bill_status app_public.bill_status;
  v_allocated integer;
  v_bill_total integer;
  v_bill_adjustments integer;
  v_bill_credits integer;
  v_bill_payments integer;
begin
  select family_id, amount_cents into v_payment_family, v_payment_amount
    from app_public.payments where id = NEW.payment_id for update;
  select family_id, status, total_cents into v_bill_family, v_bill_status, v_bill_total
    from app_public.bills where id = NEW.bill_id for update;
  select coalesce(sum(amount_cents), 0) into v_bill_adjustments from app_public.bill_adjustments where bill_id = NEW.bill_id;
  select coalesce(sum(amount_cents), 0) into v_bill_credits from app_public.family_credit_applications where bill_id = NEW.bill_id;
  select coalesce(sum(amount_cents), 0) into v_bill_payments from app_public.payment_allocations where bill_id = NEW.bill_id and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_payment_family is null or v_bill_family is null
     or v_payment_family <> v_bill_family then
    raise exception 'Payment and bill must belong to the same family';
  end if;
  if v_bill_status not in ('issued', 'paid') then
    raise exception 'Payments can only be allocated to issued bills';
  end if;

  select coalesce(sum(amount_cents), 0) into v_allocated
    from app_public.payment_allocations
   where payment_id = NEW.payment_id
     and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_allocated + NEW.amount_cents > v_payment_amount then
    raise exception 'Payment allocations exceed the payment amount';
  end if;
  if NEW.amount_cents > greatest(0, v_bill_total + v_bill_adjustments - v_bill_credits - v_bill_payments) then
    raise exception 'Payment allocation exceeds the bill outstanding balance';
  end if;
  return NEW;
end;
$$;

drop trigger if exists _validate on app_public.payment_allocations;
create trigger _validate
  before insert or update on app_public.payment_allocations
  for each row execute function app_private.tg_payment_allocations__validate();

create or replace function app_private.tg_credit_applications__validate()
returns trigger
security definer
set search_path to pg_catalog
language plpgsql as $$
declare
  v_credit_family uuid;
  v_credit_amount integer;
  v_bill_family uuid;
  v_bill_status app_public.bill_status;
  v_applied integer;
  v_bill_total integer;
  v_bill_adjustments integer;
  v_bill_credits integer;
  v_bill_payments integer;
begin
  select family_id, amount_cents into v_credit_family, v_credit_amount
    from app_public.family_credits where id = NEW.credit_id for update;
  select family_id, status, total_cents into v_bill_family, v_bill_status, v_bill_total
    from app_public.bills where id = NEW.bill_id for update;
  select coalesce(sum(amount_cents), 0) into v_bill_adjustments from app_public.bill_adjustments where bill_id = NEW.bill_id;
  select coalesce(sum(amount_cents), 0) into v_bill_credits from app_public.family_credit_applications where bill_id = NEW.bill_id and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  select coalesce(sum(amount_cents), 0) into v_bill_payments from app_public.payment_allocations where bill_id = NEW.bill_id;
  if v_credit_family is null or v_bill_family is null
     or v_credit_family <> v_bill_family then
    raise exception 'Credit and bill must belong to the same family';
  end if;
  if v_bill_status not in ('issued', 'paid') then
    raise exception 'Credits can only be applied to issued bills';
  end if;
  select coalesce(sum(amount_cents), 0) into v_applied
    from app_public.family_credit_applications
   where credit_id = NEW.credit_id
     and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_applied + NEW.amount_cents > v_credit_amount then
    raise exception 'Credit applications exceed the credit amount';
  end if;
  if NEW.amount_cents > greatest(0, v_bill_total + v_bill_adjustments - v_bill_credits - v_bill_payments) then
    raise exception 'Credit application exceeds the bill outstanding balance';
  end if;
  return NEW;
end;
$$;

drop trigger if exists _validate on app_public.family_credit_applications;
create trigger _validate
  before insert or update on app_public.family_credit_applications
  for each row execute function app_private.tg_credit_applications__validate();

create or replace function app_private.tg_credit_applications__consume()
returns trigger
security definer
set search_path to pg_catalog
language plpgsql as $$
begin
  update app_public.family_credits
     set consumed_at = coalesce(consumed_at, now())
   where id = NEW.credit_id
     and consumed_at is null
     and (select coalesce(sum(amount_cents), 0)
            from app_public.family_credit_applications
           where credit_id = NEW.credit_id)
         >= amount_cents;
  return NEW;
end;
$$;

drop trigger if exists _consume on app_public.family_credit_applications;
create trigger _consume
  after insert or update on app_public.family_credit_applications
  for each row execute function app_private.tg_credit_applications__consume();

create or replace function app_private.tg_refunds__validate()
returns trigger
security definer
set search_path to pg_catalog
language plpgsql as $$
declare
  v_amount integer;
  v_refunded integer;
begin
  select amount_cents into v_amount
    from app_public.payments where id = NEW.payment_id for update;
  select coalesce(sum(amount_cents), 0) into v_refunded
    from app_public.refunds
   where payment_id = NEW.payment_id
     and reversed_at is null
     and id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_refunded + NEW.amount_cents > v_amount then
    raise exception 'Refunds exceed the payment amount';
  end if;
  return NEW;
end;
$$;

drop trigger if exists _validate on app_public.refunds;
create trigger _validate
  before insert or update on app_public.refunds
  for each row execute function app_private.tg_refunds__validate();

-- Credit applications are financial events and must be audited as well.
drop trigger if exists _audit on app_public.family_credit_applications;
create trigger _audit
  after insert or update or delete on app_public.family_credit_applications
  for each row execute function app_private.tg__audit_record();
