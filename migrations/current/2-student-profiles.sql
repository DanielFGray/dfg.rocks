/*
 * Student profiles: what a student told us at onboarding. student_profiles holds one row per
 * account with the free-text background; student_instruments holds one row per instrument the
 * student wants to learn, with how long they have played it.
 *
 * Instruments are the contact form's values (shared/contactOptions.ts), so an inquiry and a
 * profile use the same words; other_instrument names the instrument when it is 'other'.
 * Experience is a range, not a number of years: people answer a range honestly and a number
 * badly. shared/studentProfile.ts lists the same values for the forms.
 *
 * The student and staff read and write the profile. Family members read it, as they read a
 * student's practice.
 */

create table if not exists app_public.student_profiles (
  user_id uuid primary key references app_public.users(id) on delete cascade,
  background text not null default '' check (length(background) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app_public.student_profiles is
  'What a student told us about themself at onboarding: background is free text about how they came to music and what they want from lessons.';

create table if not exists app_public.student_instruments (
  user_id uuid not null references app_public.users(id) on delete cascade,
  instrument text not null check (instrument in ('drums', 'guitar', 'piano', 'other')),
  experience text not null,
  primary key (user_id, instrument)
);

alter table app_public.student_instruments
  add column if not exists other_instrument text;

alter table app_public.student_instruments
  drop constraint if exists student_instruments_experience_check,
  add constraint student_instruments_experience_check check (experience in (
    'none', 'under_1_year', '1_to_3_years', '3_to_5_years', '5_to_10_years', 'over_10_years'
  )),
  drop constraint if exists student_instruments_other_instrument_check,
  add constraint student_instruments_other_instrument_check check (
    other_instrument is null
    or (instrument = 'other' and length(trim(other_instrument)) between 1 and 100)
  );

comment on table app_public.student_instruments is
  'An instrument a student wants to learn, and how long they have played it. instrument takes the contact form''s values (shared/contactOptions.ts).';

drop trigger if exists _100_timestamps on app_public.student_profiles;
create trigger _100_timestamps before insert or update on app_public.student_profiles
  for each row execute function app_private.tg__timestamps();

alter table app_public.student_profiles enable row level security;
alter table app_public.student_instruments enable row level security;

grant select, delete on app_public.student_profiles to :DATABASE_VISITOR;
grant insert (user_id, background), update (background) on app_public.student_profiles to :DATABASE_VISITOR;
grant select, delete on app_public.student_instruments to :DATABASE_VISITOR;
grant insert (user_id, instrument, experience, other_instrument), update (experience, other_instrument)
  on app_public.student_instruments to :DATABASE_VISITOR;

drop policy if exists select_own on app_public.student_profiles;
create policy select_own on app_public.student_profiles for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or user_id = app_public.current_user_id()
    or user_id in (select app_public.current_user_family_member_ids())
  );

drop policy if exists manage_own on app_public.student_profiles;
create policy manage_own on app_public.student_profiles for all
  using (app_public.current_user_role() in ('admin', 'teacher') or user_id = app_public.current_user_id())
  with check (app_public.current_user_role() in ('admin', 'teacher') or user_id = app_public.current_user_id());

drop policy if exists select_own on app_public.student_instruments;
create policy select_own on app_public.student_instruments for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or user_id = app_public.current_user_id()
    or user_id in (select app_public.current_user_family_member_ids())
  );

drop policy if exists manage_own on app_public.student_instruments;
create policy manage_own on app_public.student_instruments for all
  using (app_public.current_user_role() in ('admin', 'teacher') or user_id = app_public.current_user_id())
  with check (app_public.current_user_role() in ('admin', 'teacher') or user_id = app_public.current_user_id());
