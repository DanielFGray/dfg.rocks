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

grant select,
  insert (sender_id, recipient_id, body),
  update (is_read) on app_public.messages to :DATABASE_VISITOR;

comment on table app_public.messages is 'Direct messages between users (admin<->student communication).';
