import * as S from "effect/Schema";
import * as Schemas from "./schemas.js";
import type {
  AssignedMaterial,
  Course,
  CourseDetail,
  Family,
  Lesson,
  LessonNote,
  Material,
  Message,
  StudentDetail,
  Testimonial,
  User,
  UserEmail,
} from "./schemas.js";

type UserRecord = {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  role: "admin" | "student" | "parent" | "teacher";
  is_verified: boolean;
};

const testimonialRoleLabels = {
  admin: "Admin",
  parent: "Parent",
  student: "Student",
  teacher: "Teacher",
} as const;

export function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function toIsoStringOrNull(value: Date | string | null): string | null {
  return value ? toIsoString(value) : null;
}

export function serializeMaterial<
  T extends {
    id: string;
    title: string;
    original_filename: string;
    mime_type: string;
    file_size: unknown;
    is_global: boolean;
    notation_tracks: unknown;
    assigned_track_index: number | null;
  },
>(material: T) {
  return {
    id: material.id,
    title: material.title,
    original_filename: material.original_filename,
    mime_type: material.mime_type,
    file_size: S.decodeUnknownSync(S.Number)(material.file_size),
    is_global: material.is_global,
    notation_tracks: S.decodeUnknownSync(S.NullishOr(S.Array(Schemas.MaterialNotationTrack)))(
      material.notation_tracks,
    ),
    assigned_track_index: material.assigned_track_index,
  };
}

export function serializeLibraryMaterial(material: {
  id: string;
  title: string;
  original_filename: string;
  mime_type: string;
  file_size: unknown;
  is_global: boolean;
  notation_tracks: unknown;
}): Material {
  return S.decodeUnknownSync(Schemas.Material)({
    ...material,
    file_size: S.decodeUnknownSync(S.Number)(material.file_size),
    notation_tracks: S.decodeUnknownSync(S.NullishOr(S.Array(Schemas.MaterialNotationTrack)))(
      material.notation_tracks,
    ),
  });
}

export function serializeAssignedMaterial(material: {
  id: string;
  title: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  is_global: boolean;
  notation_tracks: unknown;
  assigned_track_index: number | null;
  listened_seconds?: number;
}): AssignedMaterial {
  return S.decodeUnknownSync(Schemas.AssignedMaterial)({
    ...serializeMaterial(material),
    listened_seconds: material.listened_seconds,
  });
}

export function serializeCourse(course: {
  id: string;
  title: string;
  description: string;
  instrument: string;
}): Course {
  return S.decodeUnknownSync(Schemas.Course)(course);
}

export function serializeCourseDetail(course: unknown): CourseDetail {
  return S.decodeUnknownSync(Schemas.CourseDetail)(course);
}

export function serializeStudentDetail(student: unknown): StudentDetail {
  return S.decodeUnknownSync(Schemas.StudentDetail)(student);
}

export function serializeFamily(family: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: Date | string;
}): Family {
  return S.decodeUnknownSync(Schemas.Family)({
    ...family,
    created_at: toIsoString(family.created_at),
  });
}

export function serializeLesson(lesson: {
  id: string;
  student_id: string;
  gcal_event_id: string | null;
  scheduled_at: Date | string;
  duration_minutes: number;
  location_type: Lesson["location_type"];
  status: Lesson["status"];
  cancellation_reason: string | null;
  cancelled_at: Date | string | null;
  completed_at: Date | string | null;
  cancellation_fee_cents: number;
  remainder_due_cents: number;
  recurring_schedule_id?: string | null;
  recurrence_date?: Date | string | null;
  created_at: Date | string;
}): Lesson {
  return S.decodeUnknownSync(Schemas.Lesson)({
    ...lesson,
    scheduled_at: toIsoString(lesson.scheduled_at),
    cancelled_at: toIsoStringOrNull(lesson.cancelled_at),
    completed_at: toIsoStringOrNull(lesson.completed_at),
    recurring_schedule_id: lesson.recurring_schedule_id ?? null,
    recurrence_date:
      lesson.recurrence_date instanceof Date
        ? lesson.recurrence_date.toISOString().slice(0, 10)
        : (lesson.recurrence_date ?? null),
    created_at: toIsoString(lesson.created_at),
  });
}

export function serializeLessonNote(note: {
  id: string;
  lesson_id: string;
  topics_covered: string | null;
  homework: string | null;
  progress_observations: string | null;
  notes: string | null;
  material_ids: unknown;
  draft: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}): LessonNote {
  return S.decodeUnknownSync(Schemas.LessonNote)({
    ...note,
    material_ids: S.decodeUnknownSync(S.NullishOr(S.Array(S.String)))(note.material_ids),
    created_at: toIsoString(note.created_at),
    updated_at: toIsoString(note.updated_at),
  });
}

export function serializeMessage(message: {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  is_read: boolean;
  created_at: Date | string;
}): Message {
  return S.decodeUnknownSync(Schemas.Message)({
    ...message,
    created_at: toIsoString(message.created_at),
  });
}

export function serializeUserEmail(email: {
  id: string;
  email: string;
  is_verified: boolean;
  is_primary: boolean;
  created_at: Date | string;
}): UserEmail {
  return S.decodeUnknownSync(Schemas.UserEmail)({
    ...email,
    created_at: toIsoString(email.created_at),
  });
}

export function serializeTestimonial(testimonial: {
  id: string;
  user_id: string;
  body: string;
  is_approved: boolean;
  username: string;
  name: string | null;
  role: "admin" | "student" | "parent" | "teacher";
  created_at: Date | string;
  updated_at: Date | string;
}): Testimonial {
  return S.decodeUnknownSync(Schemas.Testimonial)({
    id: testimonial.id,
    user_id: testimonial.user_id,
    body: testimonial.body,
    display_name: testimonial.name?.trim() || testimonial.username,
    role_label: testimonialRoleLabels[testimonial.role],
    is_approved: testimonial.is_approved,
    created_at: toIsoString(testimonial.created_at),
    updated_at: toIsoString(testimonial.updated_at),
  });
}

export function normalizeStudents(rows: readonly UserRecord[]): User[] {
  return rows.map((student) =>
    S.decodeUnknownSync(Schemas.User)({
      ...student,
      name: student.name ?? "",
      email: student.email ?? "",
    }),
  );
}
