create table app_public.lesson_deposits (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references app_public.lessons(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  status app_public.deposit_status not null default 'held',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_public.lesson_deposits enable row level security;

create policy select_own on app_public.lesson_deposits for select
  using (
    app_public.current_user_role() = 'admin'
    or lesson_id in (
      select id from app_public.lessons
      where student_id = app_public.current_user_id()
        or student_id in (select app_public.current_user_family_member_ids())
    )
  );

grant select on app_public.lesson_deposits to :DATABASE_VISITOR;

comment on table app_public.lesson_deposits is 'Deposit tracking for lessons. 1/3 lesson price held at booking, refunded or captured based on cancellation policy.';
comment on column app_public.lesson_deposits.amount_cents is 'Deposit amount in cents.';
comment on column app_public.lesson_deposits.status is 'Lifecycle: held -> refunded | captured.';
