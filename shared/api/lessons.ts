import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Schema as S } from "effect";
import {
  CancellationPolicySettings,
  Lesson,
  LessonCancellationPolicy,
  LessonNote,
  LessonStatus,
  LocationType,
  TimeSlot,
  WorkingHours,
  SuccessResponse,
} from "../schemas.js";
import { params, PaginationQuery } from "./fields.js";
import { signedInErrors, adminErrors } from "../httpApiErrors.js";

const MyLessonsQuery = S.Struct({
  limit: S.optional(S.NumberFromString),
  offset: S.optional(S.NumberFromString),
  status: S.optional(LessonStatus),
  from: S.optional(S.String),
  to: S.optional(S.String),
});

const AvailableSlotsQuery = S.Struct({
  date: S.String,
  days: S.optional(S.NumberFromString),
  duration: S.optional(S.NumberFromString),
});

const BookLessonPayload = S.Struct({
  scheduled_at: S.String,
  duration_minutes: S.Number,
  location_type: LocationType,
  student_id: S.optional(S.String),
});

const CreateLessonPayload = S.Struct({
  student_id: S.String,
  scheduled_at: S.String,
  duration_minutes: S.Number,
  location_type: LocationType,
});

const UpdateLessonPayload = S.Struct({
  scheduled_at: S.optional(S.String),
  duration_minutes: S.optional(S.Number),
  location_type: S.optional(LocationType),
});

const AdminLessonsQuery = S.Struct({
  limit: S.optional(S.NumberFromString),
  offset: S.optional(S.NumberFromString),
  student_id: S.optional(S.String),
  status: S.optional(LessonStatus),
  from: S.optional(S.String),
  to: S.optional(S.String),
});

const SaveLessonNotePayload = S.Struct({
  topics_covered: S.optional(S.String),
  homework: S.optional(S.String),
  progress_observations: S.optional(S.String),
  notes: S.optional(S.String),
  material_ids: S.optional(S.Array(S.String)),
  draft: S.optional(S.Boolean),
});

export const CancelLessonPayload = S.Struct({
  reason: S.optional(S.String.pipe(S.check(S.isMaxLength(1000)))),
});

export const RescheduleLessonPayload = S.Struct({
  scheduled_at: S.String,
});

export const SaveCancellationPolicySettingsPayload = S.Struct({
  cancellation_window_hours: S.Number.pipe(S.check(S.isBetween({ minimum: 0, maximum: 720 }))),
  late_cancel_charge_percent: S.Number.pipe(S.check(S.isBetween({ minimum: 0, maximum: 100 }))),
});

export const lessonsGroup = HttpApiGroup.make("lessons")
  .add(
    HttpApiEndpoint.get("myLessons", "/my-lessons", {
      error: signedInErrors,
      query: MyLessonsQuery,
      success: S.Array(Lesson),
    }),
  )
  .add(
    HttpApiEndpoint.get("myLessonCancellationPolicy", "/my-lessons/:id/cancellation-policy", {
      error: signedInErrors,
      params: params("id"),
      success: LessonCancellationPolicy,
    }),
  )
  .add(
    HttpApiEndpoint.post("cancelMyLesson", "/my-lessons/:id/cancel", {
      error: signedInErrors,
      params: params("id"),
      payload: CancelLessonPayload,
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.post("rescheduleMyLesson", "/my-lessons/:id/reschedule", {
      error: signedInErrors,
      params: params("id"),
      payload: RescheduleLessonPayload,
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.get("myLessonNotesList", "/my-lesson-notes", {
      error: signedInErrors,
      query: PaginationQuery,
      success: S.Array(LessonNote),
    }),
  )
  .add(
    HttpApiEndpoint.get("availableSlots", "/available-slots", {
      error: signedInErrors,
      query: AvailableSlotsQuery,
      success: S.Array(TimeSlot),
    }),
  )
  .add(
    HttpApiEndpoint.post("bookLesson", "/my-lessons/book", {
      error: signedInErrors,
      payload: BookLessonPayload,
      success: Lesson,
    }),
  )
  .prefix("/api");

export const lessonsAdminGroup = HttpApiGroup.make("lessonsAdmin")
  .add(
    HttpApiEndpoint.post("createLesson", "/lessons", {
      error: adminErrors,
      payload: CreateLessonPayload,
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.patch("updateLesson", "/lessons/:id", {
      error: adminErrors,
      params: params("id"),
      payload: UpdateLessonPayload,
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.get("lessons", "/lessons", {
      error: adminErrors,
      query: AdminLessonsQuery,
      success: S.Array(Lesson),
    }),
  )
  .add(
    HttpApiEndpoint.post("cancelLesson", "/lessons/:id/cancel", {
      error: adminErrors,
      params: params("id"),
      payload: CancelLessonPayload,
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.post("completeLesson", "/lessons/:id/complete", {
      error: adminErrors,
      params: params("id"),
      success: Lesson,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteLesson", "/lessons/:id", {
      error: adminErrors,
      params: params("id"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveLessonNote", "/lessons/:id/notes", {
      error: adminErrors,
      params: params("id"),
      payload: SaveLessonNotePayload,
      success: LessonNote,
    }),
  )
  .add(
    HttpApiEndpoint.get("lessonNote", "/lessons/:id/notes", {
      error: adminErrors,
      params: params("id"),
      success: LessonNote,
    }),
  )
  .add(
    HttpApiEndpoint.patch("publishLessonNote", "/lessons/:id/notes/publish", {
      error: adminErrors,
      params: params("id"),
      success: LessonNote,
    }),
  )
  .add(
    HttpApiEndpoint.get("workingHours", "/working-hours", {
      error: adminErrors,
      success: WorkingHours,
    }),
  )
  .add(
    HttpApiEndpoint.get("cancellationPolicySettings", "/cancellation-policy", {
      error: adminErrors,
      success: CancellationPolicySettings,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveCancellationPolicySettings", "/cancellation-policy", {
      error: adminErrors,
      payload: SaveCancellationPolicySettingsPayload,
      success: CancellationPolicySettings,
    }),
  )
  .add(
    HttpApiEndpoint.post("saveWorkingHours", "/working-hours", {
      error: adminErrors,
      payload: WorkingHours,
      success: SuccessResponse,
    }),
  )
  .prefix("/api/admin");
