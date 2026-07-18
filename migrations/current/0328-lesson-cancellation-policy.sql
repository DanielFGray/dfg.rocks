create type app_public.billing_model as enum ('single_booking', 'monthly_prepaid');

alter table app_public.student_rates
  add column billing_model app_public.billing_model not null default 'single_booking';

alter table app_public.lessons
  add column cancellation_fee_cents integer not null default 0
    check (cancellation_fee_cents >= 0),
  add column remainder_due_cents integer not null default 0
    check (remainder_due_cents >= 0);

insert into app_private.admin_settings (key, value)
values
  ('cancellation_window_hours', '24'::jsonb),
  ('late_cancel_charge_percent', '50'::jsonb)
on conflict (key) do nothing;

drop policy if exists update_own_scheduled on app_public.lessons;
create policy update_own_scheduled on app_public.lessons for update
  using (
    status = 'scheduled'
    and app_public.is_acting_for_family_student(student_id)
  )
  with check (
    app_public.is_acting_for_family_student(student_id)
    and status in ('scheduled', 'cancelled')
  );

drop policy if exists update_own on app_public.lesson_deposits;
create policy update_own on app_public.lesson_deposits for update
  using (
    lesson_id in (
      select id from app_public.lessons
      where app_public.is_acting_for_family_student(student_id)
    )
  )
  with check (
    lesson_id in (
      select id from app_public.lessons
      where app_public.is_acting_for_family_student(student_id)
    )
  );

comment on column app_public.student_rates.billing_model is
  'How lessons at this rate are billed: per-booking deposit or monthly prepaid.';
comment on column app_public.lessons.cancellation_fee_cents is
  'Fee recorded when a monthly-prepaid lesson is cancelled inside the policy window.';
comment on column app_public.lessons.remainder_due_cents is
  'Amount still due after a completed single-booking lesson deposit is captured.';
