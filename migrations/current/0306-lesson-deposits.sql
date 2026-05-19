create table app_public.lesson_deposits (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references app_public.lessons(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  status app_public.deposit_status not null default 'held',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_public.lesson_deposits enable row level security;

grant select on app_public.lesson_deposits to :DATABASE_VISITOR;

comment on table app_public.lesson_deposits is 'Deposit tracking for lessons. 1/3 lesson price held at booking, refunded or captured based on cancellation policy.';
comment on column app_public.lesson_deposits.amount_cents is 'Deposit amount in cents.';
comment on column app_public.lesson_deposits.status is 'Lifecycle: held -> refunded | captured.';
