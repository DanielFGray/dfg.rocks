create table app_public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references app_public.users(id) on delete cascade,
  recipient_id uuid not null references app_public.users(id) on delete cascade,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index messages_recipient on app_public.messages(recipient_id, created_at desc);
create index messages_sender on app_public.messages(sender_id, created_at desc);

alter table app_public.messages
  add constraint messages_body_length check (length(body) <= 10000);

alter table app_public.messages enable row level security;

create policy select_own on app_public.messages for select
  using (
    app_public.current_user_role() = 'admin'
    or sender_id = app_public.current_user_id()
    or recipient_id = app_public.current_user_id()
    or sender_id in (select app_public.current_user_family_member_ids())
    or recipient_id in (select app_public.current_user_family_member_ids())
  );

create policy insert_sender on app_public.messages for insert
  with check (sender_id = app_public.current_user_id());

create policy update_recipient on app_public.messages for update
  using (recipient_id = app_public.current_user_id());

grant select,
  insert (sender_id, recipient_id, body),
  update (is_read) on app_public.messages to :DATABASE_VISITOR;

comment on table app_public.messages is 'Direct messages between users (admin<->student communication).';
