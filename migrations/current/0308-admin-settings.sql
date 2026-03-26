create table app_private.admin_settings (
  key text primary key,
  value jsonb not null
);

comment on table app_private.admin_settings is 'Admin configuration store. Keys: working_hours, google_calendar_id, etc.';
