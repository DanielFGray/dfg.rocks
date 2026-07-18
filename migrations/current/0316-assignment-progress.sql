create table app_public.assignment_progress (
  student_id uuid not null,
  material_id uuid not null,
  listened_seconds integer not null default 0 check (listened_seconds >= 0),
  last_played_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (student_id, material_id),
  foreign key (student_id, material_id)
    references app_public.student_materials(student_id, material_id)
    on delete cascade
);

create index assignment_progress_student_updated_at
  on app_public.assignment_progress(student_id, updated_at desc);

alter table app_public.assignment_progress enable row level security;

create policy select_own on app_public.assignment_progress for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_own on app_public.assignment_progress for insert
  with check (student_id = app_public.current_user_id());

create policy update_own on app_public.assignment_progress for update
  using (student_id = app_public.current_user_id());

create policy insert_admin on app_public.assignment_progress for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));
create policy update_admin on app_public.assignment_progress for update
  using (app_public.current_user_role() in ('admin', 'teacher'));
create policy delete_admin on app_public.assignment_progress for delete
  using (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert, update, delete on app_public.assignment_progress to :DATABASE_VISITOR;
grant insert (student_id, material_id, listened_seconds, last_played_at, updated_at)
  on app_public.assignment_progress to :DATABASE_VISITOR;
grant update (listened_seconds, last_played_at, updated_at)
  on app_public.assignment_progress to :DATABASE_VISITOR;

comment on table app_public.assignment_progress is
  'Per-student cumulative playback progress for directly assigned materials.';
comment on column app_public.assignment_progress.listened_seconds is
  'Cumulative time in whole seconds that notation playback has actively run for this assignment.';

create table app_public.assignment_reviews (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  material_id uuid not null,
  stars smallint not null check (stars between 1 and 5),
  listened_seconds integer not null default 0 check (listened_seconds >= 0),
  created_at timestamptz not null default now(),
  foreign key (student_id, material_id)
    references app_public.student_materials(student_id, material_id)
    on delete cascade
);

create index assignment_reviews_student_material_created_at
  on app_public.assignment_reviews(student_id, material_id, created_at desc);

alter table app_public.assignment_reviews enable row level security;

create policy select_own on app_public.assignment_reviews for select
  using (
    app_public.current_user_role() in ('admin', 'teacher')
    or student_id = app_public.current_user_id()
    or student_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_own on app_public.assignment_reviews for insert
  with check (student_id = app_public.current_user_id());

create policy insert_admin on app_public.assignment_reviews for insert
  with check (app_public.current_user_role() in ('admin', 'teacher'));

grant select, insert on app_public.assignment_reviews to :DATABASE_VISITOR;
grant insert (student_id, material_id, stars, listened_seconds)
  on app_public.assignment_reviews to :DATABASE_VISITOR;

comment on table app_public.assignment_reviews is
  'Historical 1-5 self-reviews recorded by students for assigned materials.';
comment on column app_public.assignment_reviews.listened_seconds is
  'The student''s cumulative listened seconds snapshot at the moment this review was recorded.';
