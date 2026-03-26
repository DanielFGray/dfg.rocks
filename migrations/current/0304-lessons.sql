create table app_public.lessons (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app_public.users(id) on delete cascade,
  gcal_event_id text unique,
  scheduled_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  location_type app_public.location_type not null,
  status app_public.lesson_status not null default 'scheduled',
  cancellation_reason text,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_public.lessons enable row level security;

create index lessons_student_scheduled on app_public.lessons(student_id, scheduled_at);
create index lessons_scheduled_at on app_public.lessons(scheduled_at);

create policy select_own on app_public.lessons for select
  using (
    app_public.current_user_role() = 'admin'
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

grant select on app_public.lessons to :DATABASE_VISITOR;

comment on table app_public.lessons is 'Scheduled lessons. Google Calendar is the source of truth; scheduled_at is cached for queries.';
comment on column app_public.lessons.gcal_event_id is 'Google Calendar event ID. Nullable for lessons not yet synced; unique when set.';
comment on column app_public.lessons.scheduled_at is 'Lesson start time, cached from Google Calendar.';
comment on column app_public.lessons.status is 'Lifecycle: scheduled -> completed | cancelled | no_show.';
comment on column app_public.lessons.cancellation_reason is 'Why the lesson was cancelled (student, teacher, weather, etc).';
comment on column app_public.lessons.cancelled_at is 'When the lesson was cancelled (for deposit refund policy calculations).';
comment on column app_public.lessons.completed_at is 'When the lesson was marked complete.';

create trigger _timestamps
  before insert or update on app_public.lessons
  for each row execute function app_private.tg__timestamps();
