-- Create the immutable financial obligation at the time a single-booking
-- lesson is reserved. Deposit state is tracked separately on lesson_deposits.

create or replace function app_public.create_single_booking_obligation(
  p_lesson_id uuid,
  p_rate_cents integer
) returns uuid
  security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_student_id uuid;
  v_family_id uuid;
  v_bill_id uuid;
  v_bill_number integer;
  v_lesson_date date;
begin
  if p_rate_cents <= 0 then
    raise exception 'Single-booking rate must be positive';
  end if;

  select student_id, (scheduled_at at time zone 'America/Chicago')::date
    into v_student_id, v_lesson_date
   from app_public.lessons
   where id = p_lesson_id
   for update;
  if v_student_id is null then
    raise exception 'Lesson not found';
  end if;

  select fm.family_id
    into v_family_id
    from app_public.family_memberships fm
   where fm.user_id = v_student_id
   order by fm.is_billing_contact desc, fm.is_owner desc
   limit 1;
  if v_family_id is null then
    raise exception 'Student has no billing family';
  end if;

  if not (
    v_student_id = app_public.current_user_id()
    or v_family_id in (select app_public.current_user_member_family_ids())
  ) then
    raise insufficient_privilege using message = 'Not authorized to create this booking obligation';
  end if;

  select b.id
    into v_bill_id
    from app_public.bill_line_items bli
    join app_public.bills b on b.id = bli.bill_id
   where bli.lesson_id = p_lesson_id
   limit 1;
  if v_bill_id is not null then
    return v_bill_id;
  end if;

  select app_public.next_bill_number(v_family_id) into v_bill_number;
  insert into app_public.bills (
    family_id, bill_number, status, billing_period_start,
    billing_period_end, due_date, subtotal_cents, discount_cents,
    tax_cents, total_cents
  ) values (
    v_family_id, v_bill_number, 'draft', v_lesson_date, v_lesson_date,
    v_lesson_date, p_rate_cents, 0, 0, p_rate_cents
  ) returning id into v_bill_id;

  insert into app_public.bill_line_items (
    bill_id, student_id, line_type, description, quantity,
    unit_price_cents, amount_cents, lesson_id
  ) values (
    v_bill_id, v_student_id, 'single_booking', 'Single lesson booking',
    1, p_rate_cents, p_rate_cents, p_lesson_id
  );

  update app_public.bills
     set status = 'issued', issued_at = now()
   where id = v_bill_id;

  return v_bill_id;
end;
$$;

grant execute on function app_public.create_single_booking_obligation(uuid, integer)
  to :DATABASE_VISITOR;

comment on function app_public.create_single_booking_obligation(uuid, integer) is
  'Creates and issues the immutable bill for a single-booking lesson exactly once.';

create or replace function app_public.settle_single_booking_cancellation(
  p_lesson_id uuid,
  p_deposit_cents integer,
  p_deposit_captured boolean
) returns void
  security definer
  set search_path to pg_catalog
  language plpgsql as $$
declare
  v_student_id uuid;
  v_family_id uuid;
  v_bill_id uuid;
  v_reason text;
begin
  select student_id into v_student_id
    from app_public.lessons
   where id = p_lesson_id;
  select fm.family_id into v_family_id
    from app_public.family_memberships fm
   where fm.user_id = v_student_id
   order by fm.is_billing_contact desc, fm.is_owner desc
   limit 1;
  if v_student_id is null or v_family_id is null then
    raise exception 'Booking family not found';
  end if;
  if not (
    v_student_id = app_public.current_user_id()
    or v_family_id in (select app_public.current_user_member_family_ids())
  ) then
    raise insufficient_privilege using message = 'Not authorized to settle this booking';
  end if;

  select b.id into v_bill_id
    from app_public.bill_line_items bli
    join app_public.bills b on b.id = bli.bill_id
   where bli.lesson_id = p_lesson_id
   limit 1;
  if v_bill_id is null then
    return;
  end if;

  update app_public.bills
     set status = case when status in ('draft', 'issued') then 'cancelled' else status end,
         cancelled_at = case when status in ('draft', 'issued') then now() else cancelled_at end
   where id = v_bill_id;

  if p_deposit_captured and p_deposit_cents > 0 then
    v_reason := 'Captured deposit for cancelled single booking ' || p_lesson_id::text;
    insert into app_public.family_credits (
      family_id, student_id, amount_cents, reason, created_by
    )
    select v_family_id, v_student_id, p_deposit_cents, v_reason,
           app_public.current_user_id()
    where not exists (
      select 1 from app_public.family_credits
       where family_id = v_family_id and reason = v_reason
    );
  end if;
end;
$$;

grant execute on function app_public.settle_single_booking_cancellation(uuid, integer, boolean)
  to :DATABASE_VISITOR;
