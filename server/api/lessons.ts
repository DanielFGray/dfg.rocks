import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { serializeLesson, serializeLessonNote } from "../../shared/responseMappers.js";
import { HttpError } from "../pgErrors.js";
import { AuthenticatedRouteService } from "../services/authenticatedRouteService.js";
import { GoogleCalendarService } from "../services/googleCalendarService.js";
import { resolveEffectiveStudent } from "../services/sessionService.js";
import { AdminRouteService } from "../services/adminRouteService.js";
import { adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";

export const LessonsApiGroupLive = HttpApiBuilder.group(Contract, "lessons", (handlers) =>
  handlers
    .handle(
      "myLessons",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const filterStudentId = effective.isActing ? effective.studentId : undefined;
        const rows = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.myLessons(
            auth.session.id,
            {
              limit: query.limit ?? 50,
              offset: query.offset ?? 0,
              status: query.status,
              from: query.from,
              to: query.to,
            },
            filterStudentId,
          ),
        );
        return rows.map((row) => serializeLesson(row));
      }, adaptSignedInErrors),
    )
    .handle(
      "myLessonCancellationPolicy",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        return yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.myLessonCancellationPolicy({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            lessonId: params.id,
          }),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "cancelMyLesson",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const lesson = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.cancelMyLesson({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            lessonId: params.id,
            reason: payload.reason ?? null,
          }),
        );
        return serializeLesson(lesson);
      }, adaptSignedInErrors),
    )
    .handle(
      "rescheduleMyLesson",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const lesson = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.rescheduleMyLesson({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            lessonId: params.id,
            scheduledAt: payload.scheduled_at,
          }),
        );
        return serializeLesson(lesson);
      }, adaptSignedInErrors),
    )
    .handle(
      "myLessonNotesList",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const filterStudentId = effective.isActing ? effective.studentId : undefined;
        const rows = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.myLessonNotesList(
            auth.session.id,
            {
              limit: query.limit ?? 50,
              offset: query.offset ?? 0,
            },
            filterStudentId,
          ),
        );
        return rows.map((row) => ({
          ...row,
          material_ids: row.material_ids ?? null,
        }));
      }, adaptSignedInErrors),
    )
    .handle(
      "availableSlots",
      Effect.fnUntraced(function* ({ query }) {
        if (!query.date) {
          return yield* new HttpError(400, "Missing date");
        }
        return yield* GoogleCalendarService.use((googleCalendarService) =>
          googleCalendarService.getAvailableSlots({
            date: query.date,
            days: query.days ?? 7,
            duration: query.duration ?? 60,
          }),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "bookLesson",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const studentId = payload.student_id ?? effective.studentId;
        const lesson = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.bookLesson({
            sessionId: auth.session.id,
            userId: studentId,
            scheduledAt: payload.scheduled_at,
            durationMinutes: payload.duration_minutes,
            locationType: payload.location_type,
          }),
        );
        return serializeLesson(lesson);
      }, adaptSignedInErrors),
    ),
);

export const LessonsAdminApiGroupLive = HttpApiBuilder.group(Contract, "lessonsAdmin", (handlers) =>
  handlers
    .handle(
      "createLesson",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const lesson = yield* AdminRouteService.use((adminRouteService) =>
          adminRouteService.createLesson({
            sessionId: auth.session.id,
            studentId: payload.student_id,
            scheduledAt: payload.scheduled_at,
            durationMinutes: payload.duration_minutes,
            locationType: payload.location_type,
            gcalEventId: null,
          }),
        );
        return serializeLesson(lesson);
      }, adaptAdminErrors),
    )
    .handle(
      "updateLesson",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const lesson = yield* AdminRouteService.use((adminRouteService) =>
          adminRouteService.updateLesson(auth.session.id, params.id, {
            scheduledAt: payload.scheduled_at,
            durationMinutes: payload.duration_minutes,
            locationType: payload.location_type,
          }),
        );
        if (!lesson) {
          return yield* new HttpError(404, "Lesson not found");
        }
        return serializeLesson(lesson);
      }, adaptAdminErrors),
    )
    .handle(
      "deleteLesson",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        const lesson = yield* AdminRouteService.use((adminRouteService) =>
          adminRouteService.deleteLesson(auth.session.id, params.id),
        );
        if (!lesson) {
          return yield* new HttpError(404, "Lesson not found");
        }
        return { success: true as const };
      }, adaptAdminErrors),
    )
    .handle(
      "cancelLesson",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const lesson = yield* AdminRouteService.use((adminRouteService) =>
          adminRouteService.cancelLesson(auth.session.id, params.id, payload.reason ?? null),
        );
        return serializeLesson(lesson);
      }, adaptAdminErrors),
    )
    .handle(
      "completeLesson",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const lesson = yield* AdminRouteService.use((adminRouteService) =>
          adminRouteService.completeLesson(auth.session.id, params.id),
        );
        return serializeLesson(lesson);
      }, adaptAdminErrors),
    )
    .handle(
      "lessons",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
        const lessons = yield* AdminRouteService.use((adminRouteService) =>
          adminRouteService.listLessons(auth.session.id, {
            limit: query.limit ?? 50,
            offset: query.offset ?? 0,
            studentId: query.student_id,
            status: query.status,
            from: query.from ? new Date(query.from) : undefined,
            to: query.to ? new Date(query.to) : undefined,
          }),
        );
        return lessons.map(serializeLesson);
      }, adaptAdminErrors),
    )
    .handle(
      "saveLessonNote",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const note = yield* AdminRouteService.use((adminRouteService) =>
          adminRouteService.saveLessonNote(auth.session.id, params.id, {
            topicsCovered: payload.topics_covered ?? null,
            homework: payload.homework ?? null,
            progressObservations: payload.progress_observations ?? null,
            notes: payload.notes ?? null,
            materialIds: payload.material_ids ? [...payload.material_ids] : null,
            draft: payload.draft ?? true,
          }),
        );
        return serializeLessonNote(note);
      }, adaptAdminErrors),
    )
    .handle(
      "lessonNote",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        const note = yield* AdminRouteService.use((adminRouteService) =>
          adminRouteService.getLessonNote(auth.session.id, params.id),
        );
        if (!note) {
          return yield* new HttpError(404, "Lesson note not found");
        }
        return serializeLessonNote(note);
      }, adaptAdminErrors),
    )
    .handle(
      "publishLessonNote",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        const note = yield* AdminRouteService.use((adminRouteService) =>
          adminRouteService.publishLessonNote(auth.session.id, params.id),
        );
        if (!note) {
          return yield* new HttpError(404, "Lesson note not found");
        }
        return serializeLessonNote(note);
      }, adaptAdminErrors),
    )
    .handle(
      "workingHours",
      Effect.fnUntraced(function* () {
        return yield* GoogleCalendarService.use((googleCalendarService) =>
          googleCalendarService.getWorkingHours(),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "cancellationPolicySettings",
      Effect.fnUntraced(function* () {
        return yield* AdminRouteService.use((adminRouteService) =>
          adminRouteService.getCancellationPolicySettings(),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "saveCancellationPolicySettings",
      Effect.fnUntraced(function* ({ payload }) {
        return yield* AdminRouteService.use((adminRouteService) =>
          adminRouteService.saveCancellationPolicySettings(payload),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "saveWorkingHours",
      Effect.fnUntraced(function* ({ payload }) {
        yield* GoogleCalendarService.use((googleCalendarService) =>
          googleCalendarService.setWorkingHours(payload),
        );
        return { success: true as const };
      }, adaptAdminErrors),
    ),
);
