alter table app_public.materials
  rename column file_path to storage_key;

alter table app_public.materials
  add column storage_backend text not null default 'local',
  add column content_hash text;

comment on column app_public.materials.storage_backend is 'Storage backend identifier for uploaded material blobs.';
comment on column app_public.materials.storage_key is 'Backend-specific blob key used to locate uploaded material bytes.';
comment on column app_public.materials.content_hash is 'SHA-256 hash of uploaded material bytes used for deduplication.';

create unique index materials_content_hash_key
  on app_public.materials (content_hash)
  where content_hash is not null;
