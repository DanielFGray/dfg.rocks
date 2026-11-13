-- The row change authorizes and commits the calendar job. The visitor has no
-- general access to graphile-worker, and Google runs only after this commits.
create or replace function app_private.tg_lessons__sync_calendar_event() returns trigger as $$
declare
  v_lesson_id uuid;
  v_event_id text;
begin
  if tg_op = 'UPDATE' then
    if row(old.student_id, old.scheduled_at, old.duration_minutes, old.location_type, old.status)
       is not distinct from
       row(new.student_id, new.scheduled_at, new.duration_minutes, new.location_type, new.status) then
      return null;
    end if;
  end if;
  if tg_op = 'INSERT' then
    v_lesson_id := new.id;
    v_event_id := new.gcal_event_id;
  else
    v_lesson_id := old.id;
    v_event_id := old.gcal_event_id;
  end if;
  perform graphile_worker.add_job(
    'lessons__sync_calendar_event',
    json_build_object('lessonId', v_lesson_id, 'gcalEventId', v_event_id),
    queue_name := 'gcal',
    job_key := 'lessons__sync_calendar_event:' || v_lesson_id::text,
    job_key_mode := 'replace'
  );
  return null;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog;

drop trigger if exists _500_sync_calendar_event on app_public.lessons;
create trigger _500_sync_calendar_event
  after insert or update or delete on app_public.lessons
  for each row execute function app_private.tg_lessons__sync_calendar_event();
