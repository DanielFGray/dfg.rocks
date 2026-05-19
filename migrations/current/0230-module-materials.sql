create table app_public.module_materials (
  module_id uuid not null references app_public.modules(id) on delete cascade,
  material_id uuid not null references app_public.materials(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (module_id, material_id)
);

alter table app_public.module_materials enable row level security;
grant select on app_public.module_materials to :DATABASE_VISITOR;

comment on table app_public.module_materials is 'Join table linking materials to course modules.';
