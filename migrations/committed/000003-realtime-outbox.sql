--! Previous: sha1:e8701e7df6f026639eea1d4f3e85e6d4be20e4b3
--! Hash: sha1:cb4e94829e38b99587b650d42ecdda0d13c40e77
--! Message: realtime outbox

--! split: 1-current.sql
/*
 * Realtime outbox. Row triggers append one row per changed subject; a statement
 * trigger wakes listeners with an empty NOTIFY on one channel. The API holds a
 * single LISTEN connection and reads rows past the last id it processed, so the
 * number of connections does not grow with the number of tables.
 */

create table if not exists app_private.realtime_events (
  id bigint generated always as identity primary key,
  topic text not null,
  event text not null,
  subject text not null,
  created_at timestamptz not null default now()
);

alter table app_private.realtime_events enable row level security;

create index if not exists realtime_events_created_at_idx
  on app_private.realtime_events (created_at);

comment on table app_private.realtime_events is
  E'Outbox of realtime change events. Insert only through app_public.tg__graphql_subscription, which orders commits by id. The API resolves recipients and fans out over SSE.';

create or replace function app_private.tg__realtime_events__notify() returns trigger as $$
begin
  perform pg_notify('realtime_events', '');
  return null;
end;
$$ language plpgsql volatile set search_path to pg_catalog, public, pg_temp;

drop trigger if exists _900_notify on app_private.realtime_events;
create trigger _900_notify
  after insert on app_private.realtime_events
  for each statement
  execute procedure app_private.tg__realtime_events__notify();

create or replace function app_public.tg__graphql_subscription() returns trigger as $$
declare
  v_process_new bool = (TG_OP = 'INSERT' OR TG_OP = 'UPDATE');
  v_process_old bool = (TG_OP = 'UPDATE' OR TG_OP = 'DELETE');
  v_event text = TG_ARGV[0];
  v_topic text = TG_ARGV[1];
  v_attribute text = TG_ARGV[2];
  v_record record;
  v_sub text;
  v_last_sub text;
  v_i int = 0;
begin
  for v_i in 0..1 loop
    if (v_i = 0) and v_process_new is true then
      v_record = new;
    elsif (v_i = 1) and v_process_old is true then
      v_record = old;
    else
      continue;
    end if;
    execute 'select $1.' || quote_ident(v_attribute)
      using v_record
      into v_sub;
    -- An update that keeps the subject records one event, not two.
    if v_sub is not null and v_sub is distinct from v_last_sub then
      v_last_sub = v_sub;
      -- Identity values are taken at insert, not at commit. Without this lock a
      -- later id can commit first, and a reader that has moved past it never
      -- sees the earlier one. Holding the lock until commit makes ids commit in
      -- order, at the cost of writers to realtime tables waiting on each other.
      perform pg_advisory_xact_lock(hashtext('app_private.realtime_events'));
      insert into app_private.realtime_events (topic, event, subject)
      values (v_topic, v_event, v_sub);
    end if;
  end loop;
  return v_record;
end;
$$ language plpgsql volatile security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_public.tg__graphql_subscription() is
  E'Row trigger: records a realtime event for the subject column named by TG_ARGV[2] in app_private.realtime_events. Arguments: event name, topic, subject column.';
