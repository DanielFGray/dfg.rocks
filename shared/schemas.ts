/**
 * Shared response schemas — single source of truth for both server contract
 * and client-side API types. Uses Effect Schema for runtime validation on
 * the server; client derives TypeScript types via Schema.Schema.Type.
 */
import { Schema as S } from "effect";

export const UserRole = S.Literal("admin", "student", "parent");
export type UserRole = typeof UserRole.Type;

export const UserResponse = S.Struct({
  id: S.String,
  username: S.String,
  name: S.String,
  email: S.String,
  role: UserRole,
});

export const CourseResponse = S.Struct({
  id: S.String,
  title: S.String,
  description: S.String,
  instrument: S.String,
});

export const ModuleResponse = S.Struct({
  id: S.String,
  course_id: S.String,
  title: S.String,
  description: S.NullOr(S.String),
  sort_order: S.Number,
});

export const MaterialResponse = S.Struct({
  id: S.String,
  title: S.String,
  original_filename: S.String,
  mime_type: S.String,
  file_size: S.Number,
  is_global: S.Boolean,
});

export const CourseDetailResponse = S.Struct({
  ...CourseResponse.fields,
  modules: S.Array(
    S.Struct({
      ...ModuleResponse.fields,
      materials: S.Array(MaterialResponse),
    }),
  ),
});

export const StudentDetailResponse = S.Struct({
  ...UserResponse.fields,
  enrolled_courses: S.Array(
    S.Struct({ id: S.String, title: S.String, instrument: S.String }),
  ),
  assigned_materials: S.Array(MaterialResponse),
});

export const SubmissionResponse = S.Struct({
  id: S.String,
  name: S.String,
  email: S.String,
  phone: S.NullOr(S.String),
  instrument: S.String,
  format: S.String,
  message: S.String,
  is_read: S.Boolean,
  created_at: S.String,
});

export const PracticeLogResponse = S.Struct({
  id: S.String,
  student_id: S.String,
  material_id: S.String,
  status: S.Literal("practiced", "completed"),
  notes: S.NullOr(S.String),
  logged_at: S.String,
});

export const AssignmentNoteResponse = S.Struct({
  id: S.String,
  student_id: S.String,
  material_id: S.String,
  body: S.String,
  created_at: S.String,
  updated_at: S.String,
});

export const MessageResponse = S.Struct({
  id: S.String,
  sender_id: S.String,
  recipient_id: S.String,
  body: S.String,
  is_read: S.Boolean,
  created_at: S.String,
});
