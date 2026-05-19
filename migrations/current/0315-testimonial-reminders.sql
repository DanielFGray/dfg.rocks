alter table app_private.user_secrets
  add column if not exists testimonial_prompt_enabled boolean not null default false,
  add column if not exists testimonial_next_prompt_at timestamptz,
  add column if not exists testimonial_last_emailed_at timestamptz;

comment on column app_private.user_secrets.testimonial_prompt_enabled is
  'Whether the dashboard testimonial prompt should currently be shown to this user.';
comment on column app_private.user_secrets.testimonial_next_prompt_at is
  'When this user should next be prompted and emailed for a testimonial reminder.';
comment on column app_private.user_secrets.testimonial_last_emailed_at is
  'When the last testimonial reminder email was queued for this user.';

create index if not exists idx_user_secrets_testimonial_next_prompt_at
  on app_private.user_secrets (testimonial_next_prompt_at)
  where testimonial_next_prompt_at is not null;

create or replace function app_private.testimonial_reminder_interval_days()
returns integer as $$
declare
  v_value jsonb;
  v_days integer;
begin
  select value
    into v_value
    from app_private.admin_settings
    where key = 'testimonial_reminder_interval_days';

  if jsonb_typeof(v_value) = 'number' then
    v_days := (v_value #>> '{}')::integer;
  end if;

  if v_days is null or v_days < 1 or v_days > 365 then
    return 30;
  end if;

  return v_days;
end;
$$ language plpgsql stable security definer set search_path to pg_catalog, public, pg_temp;

comment on function app_private.testimonial_reminder_interval_days() is
  'Returns the configured testimonial reminder interval in days, defaulting to 30.';

create or replace function app_private.tg_user_secrets__insert_with_user() returns trigger as $$
begin
  insert into app_private.user_secrets(user_id, testimonial_next_prompt_at)
  values(
    NEW.id,
    case
      when NEW.role in ('student', 'parent') then
        NEW.created_at + make_interval(days => app_private.testimonial_reminder_interval_days())
      else null
    end
  );
  return NEW;
end;
$$ language plpgsql volatile set search_path to pg_catalog, public, pg_temp;

update app_private.user_secrets as secrets
set testimonial_prompt_enabled = false,
    testimonial_next_prompt_at = case
      when users.role in ('student', 'parent')
        and not exists (
          select 1
          from app_public.testimonials
          where testimonials.user_id = users.id
        )
      then now() + make_interval(days => app_private.testimonial_reminder_interval_days())
      else null
    end
from app_public.users as users
where users.id = secrets.user_id
  and secrets.testimonial_next_prompt_at is null;
