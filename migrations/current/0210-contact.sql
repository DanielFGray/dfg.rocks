create table app_public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  instrument text not null,
  format text not null,
  message text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table app_public.contact_submissions enable row level security;
create policy admin_all on app_public.contact_submissions
  using (app_public.current_user_role() = 'admin');
grant select, update on app_public.contact_submissions to :DATABASE_VISITOR;
grant insert on app_public.contact_submissions to :DATABASE_AUTHENTICATOR;

alter table app_public.contact_submissions
  add constraint contact_message_length check (length(message) <= 10000);

comment on table app_public.contact_submissions is 'Public contact form submissions (no auth required to create).';
