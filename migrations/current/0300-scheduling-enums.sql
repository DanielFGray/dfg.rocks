-- Scheduling enums used by student_rates, lessons, and lesson_deposits.

create type app_public.lesson_status as enum (
  'scheduled',
  'completed',
  'cancelled',
  'no_show'
);

create type app_public.location_type as enum (
  'in_person_teacher_travels',
  'in_person_student_travels',
  'studio',
  'online'
);

create type app_public.deposit_status as enum ('held', 'refunded', 'captured');
