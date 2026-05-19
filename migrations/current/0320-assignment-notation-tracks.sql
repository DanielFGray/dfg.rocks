alter table app_public.materials
  add column notation_tracks jsonb;

comment on column app_public.materials.notation_tracks is 'Detected AlphaTab track metadata for notation materials.';

alter table app_public.student_materials
  add column assigned_track_index integer,
  add constraint student_materials_assigned_track_index_nonnegative
    check (assigned_track_index is null or assigned_track_index >= 0);

comment on column app_public.student_materials.assigned_track_index is 'Optional AlphaTab track index chosen for this student assignment.';
