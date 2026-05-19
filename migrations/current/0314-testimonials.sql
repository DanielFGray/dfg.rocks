create table app_public.testimonials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default app_public.current_user_id() references app_public.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 20 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_testimonials_updated_at on app_public.testimonials (updated_at desc);

create trigger _timestamps
  before insert or update on app_public.testimonials
  for each row execute function app_private.tg__timestamps();

alter table app_public.testimonials enable row level security;

create policy select_all on app_public.testimonials for select
  using (true);

create policy insert_own_non_admin on app_public.testimonials for insert
  with check (
    user_id = app_public.current_user_id()
    and app_public.current_user_role() <> 'admin'
  );

create policy update_own_non_admin on app_public.testimonials for update
  using (
    user_id = app_public.current_user_id()
    and app_public.current_user_role() <> 'admin'
  )
  with check (
    user_id = app_public.current_user_id()
    and app_public.current_user_role() <> 'admin'
  );

create policy delete_own_non_admin on app_public.testimonials for delete
  using (
    user_id = app_public.current_user_id()
    and app_public.current_user_role() <> 'admin'
  );

grant select on app_public.testimonials to :DATABASE_VISITOR;
grant insert (body) on app_public.testimonials to :DATABASE_VISITOR;
grant update (body) on app_public.testimonials to :DATABASE_VISITOR;
grant delete on app_public.testimonials to :DATABASE_VISITOR;

comment on table app_public.testimonials is 'Public testimonials written by non-admin users. One testimonial per user.';
comment on column app_public.testimonials.body is 'A public testimonial shown on the marketing site.';
