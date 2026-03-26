create table app_public.materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  original_filename text not null,
  file_path text not null,
  mime_type text not null default 'application/octet-stream',
  file_size bigint not null default 0,
  is_global boolean not null default false,
  uploaded_by uuid references app_public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table app_public.materials is 'Uploaded files/resources (PDFs, audio, etc). Can be global or course-specific.';
