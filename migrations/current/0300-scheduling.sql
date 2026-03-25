-- Scheduling: lesson rates, lessons (synced from Google Calendar), deposits.

-- Enums
create type app_public.lesson_status as enum ('scheduled', 'completed', 'cancelled', 'no_show');
create type app_public.location_type as enum ('in_person_teacher_travels', 'in_person_student_travels', 'studio', 'online');
create type app_public.deposit_status as enum ('held', 'refunded', 'captured');

-- ============================================================================
-- student_rates: per-student lesson pricing by location type
-- ============================================================================
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

create trigger _timestamps
  before insert or update on app_public.student_rates
  for each row execute function app_private.tg__timestamps();

-- Grants: read-only for visitors (admin manages via PgRootDB)
grant select on app_public.student_rates to :DATABASE_VISITOR;

-- Constraints
alter table app_public.student_rates
  add constraint student_rates_rate_positive check (rate_cents > 0);

-- Comments
comment on table app_public.student_rates is 'Per-student lesson pricing. Rate varies by location type, travel distance, commitment level.';
comment on column app_public.student_rates.rate_cents is 'Lesson price in cents.';
comment on column app_public.student_rates.lesson_duration_minutes is 'Standard lesson length: 30 or 60 minutes.';
comment on column app_public.student_rates.location_type is 'Where the lesson takes place — determines rate.';
comment on column app_public.student_rates.notes is 'Admin notes about this rate (e.g. discount reason).';

-- ============================================================================
-- lessons: scheduled lessons, synced from Google Calendar
-- ============================================================================
create table app_public.lessons (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  gcal_event_id text unique,
  scheduled_at timestamptz not null,
  duration_minutes integer not null,
  location_type app_public.location_type not null,
  status app_public.lesson_status not null default 'scheduled',
  cancellation_reason text,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger _timestamps
  before insert or update on app_public.lessons
  for each row execute function app_private.tg__timestamps();

create index lessons_student_scheduled on app_public.lessons(student_id, scheduled_at);
create index lessons_scheduled_at on app_public.lessons(scheduled_at);

-- Grants: read-only for visitors (booking goes through server API with PgRootDB)
grant select on app_public.lessons to :DATABASE_VISITOR;

-- Constraints
alter table app_public.lessons
  add constraint lessons_duration_positive check (duration_minutes > 0);

-- Comments
comment on table app_public.lessons is 'Scheduled lessons. Google Calendar is the source of truth; scheduled_at is cached for queries.';
comment on column app_public.lessons.gcal_event_id is 'Google Calendar event ID. Nullable for lessons not yet synced; unique when set.';
comment on column app_public.lessons.scheduled_at is 'Lesson start time, cached from Google Calendar.';
comment on column app_public.lessons.status is 'Lifecycle: scheduled -> completed | cancelled | no_show.';
comment on column app_public.lessons.cancellation_reason is 'Why the lesson was cancelled (student, teacher, weather, etc).';
comment on column app_public.lessons.cancelled_at is 'When the lesson was cancelled (for deposit refund policy calculations).';
comment on column app_public.lessons.completed_at is 'When the lesson was marked complete.';

-- ============================================================================
-- lesson_deposits: deposit tracking for lessons
-- ============================================================================
create table app_public.lesson_deposits (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references app_public.lessons(id) on delete cascade,
  amount_cents integer not null,
  status app_public.deposit_status not null default 'held',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger _timestamps
  before insert or update on app_public.lesson_deposits
  for each row execute function app_private.tg__timestamps();

-- Grants: read-only for visitors
grant select on app_public.lesson_deposits to :DATABASE_VISITOR;

-- Constraints
alter table app_public.lesson_deposits
  add constraint lesson_deposits_amount_positive check (amount_cents > 0);

-- Comments
comment on table app_public.lesson_deposits is 'Deposit tracking for lessons. 1/3 lesson price held at booking, refunded or captured based on cancellation policy.';
comment on column app_public.lesson_deposits.amount_cents is 'Deposit amount in cents.';
comment on column app_public.lesson_deposits.status is 'Lifecycle: held -> refunded | captured.';

-- ============================================================================
-- admin_settings: key-value config store (private, no RLS needed)
-- ============================================================================
create table app_private.admin_settings (
  key text primary key,
  value jsonb not null
);

comment on table app_private.admin_settings is 'Admin configuration store. Keys: working_hours, google_calendar_id, etc.';
