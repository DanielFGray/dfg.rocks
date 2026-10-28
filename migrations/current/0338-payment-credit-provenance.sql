-- Preserve the payment that produced an automatic family credit.
-- This lets balance readers distinguish newly materialized excess payments
-- from legacy payments whose excess was only inferred at read time.

alter table app_public.family_credits
  add column if not exists source_payment_id uuid
    references app_public.payments(id) on delete restrict;

create unique index if not exists family_credits_source_payment
  on app_public.family_credits(source_payment_id)
  where source_payment_id is not null;

comment on column app_public.family_credits.source_payment_id is
  'Payment whose excess amount created this credit; null for manually issued or legacy credits.';
