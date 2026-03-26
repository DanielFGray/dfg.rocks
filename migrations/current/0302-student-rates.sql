create table app_public.student_rates (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  rate_cents integer not null,
  lesson_duration_minutes integer not null check (lesson_duration_minutes in (30, 60)),
  location_type app_public.location_type not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, location_type)
);

alter table app_public.student_rates enable row level security;

create trigger _timestamps
  before insert or update on app_public.student_rates
  for each row execute function app_private.tg__timestamps();

grant select on app_public.student_rates to :DATABASE_VISITOR;

alter table app_public.student_rates
  add constraint student_rates_rate_positive check (rate_cents > 0);

create policy select_own on app_public.student_rates for select
  using (
    app_public.current_user_role() = 'admin'
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

comment on table app_public.student_rates is 'Per-student lesson pricing. Rate varies by location type, travel distance, commitment level.';
comment on column app_public.student_rates.rate_cents is 'Lesson price in cents.';
comment on column app_public.student_rates.lesson_duration_minutes is 'Standard lesson length: 30 or 60 minutes.';
comment on column app_public.student_rates.location_type is 'Where the lesson takes place — determines rate.';
comment on column app_public.student_rates.notes is 'Admin notes about this rate (e.g. discount reason).';
