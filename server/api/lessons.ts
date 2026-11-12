import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { serializeLesson, serializeLessonNote } from "../../shared/responseMappers.js";
import { HttpError } from "../pgErrors.js";
import { Lessons } from "../services/lessons.js";
import { GoogleCalendar } from "../services/googleCalendar.js";
import { resolveEffectiveStudent } from "../services/sessions.js";
import { LessonPolicy } from "../services/lessonPolicy.js";
import { adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";

export const LessonsApiGroupLive = HttpApiBuilder.group(Contract, "lessons", (handlers) =>
  handlers
    .handle(
      "myLessons",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const filterStudentId = effective.isActing ? effective.studentId : undefined;
        const rows = yield* Lessons.use((lessonService) =>
          lessonService
            .myLessons(
              {
                limit: query.limit ?? 50,
                offset: query.offset ?? 0,
                status: query.status,
                from: query.from,
                to: query.to,
              },
              filterStudentId,
            )
            .pipe(withAuthContext(auth.session.id)),
        );
        return rows.map((row) => serializeLesson(row));
      }, adaptSignedInErrors),
    )
    .handle(
      "myLessonCancellationPolicy",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        return yield* Lessons.use((lessonService) =>
          lessonService
            .myLessonCancellationPolicy({
              studentId: effective.studentId,
              lessonId: params.id,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "cancelMyLesson",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const lesson = yield* Lessons.use((lessonService) =>
          lessonService
            .cancelMyLesson({
              studentId: effective.studentId,
              lessonId: params.id,
              reason: payload.reason ?? null,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return serializeLesson(lesson);
      }, adaptSignedInErrors),
    )
    .handle(
      "rescheduleMyLesson",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const lesson = yield* Lessons.use((lessonService) =>
          lessonService
            .rescheduleMyLesson({
              studentId: effective.studentId,
              lessonId: params.id,
              scheduledAt: payload.scheduled_at,
            })
            .pipe(withAuthContext(auth.session.id)),
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
        const rows = yield* Lessons.use((lessonService) =>
          lessonService
            .myLessonNotesList(
              {
                limit: query.limit ?? 50,
                offset: query.offset ?? 0,
              },
              filterStudentId,
            )
            .pipe(withAuthContext(auth.session.id)),
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
          return yield* new HttpError({ status: 400, message: "Missing date" });
        }
        return yield* GoogleCalendar.use((googleCalendarService) =>
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
        const lesson = yield* Lessons.use((lessonService) =>
          lessonService
            .bookLesson({
              userId: studentId,
              scheduledAt: payload.scheduled_at,
              durationMinutes: payload.duration_minutes,
              locationType: payload.location_type,
            })
            .pipe(withAuthContext(auth.session.id)),
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
        const lesson = yield* Lessons.use((lessonService) =>
          lessonService
            .createLesson({
              studentId: payload.student_id,
              scheduledAt: payload.scheduled_at,
              durationMinutes: payload.duration_minutes,
              locationType: payload.location_type,
              gcalEventId: null,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return serializeLesson(lesson);
      }, adaptAdminErrors),
    )
    .handle(
      "updateLesson",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const lesson = yield* Lessons.use((lessonService) =>
          lessonService
            .updateLesson(params.id, {
              scheduledAt: payload.scheduled_at,
              durationMinutes: payload.duration_minutes,
              locationType: payload.location_type,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        if (!lesson) {
          return yield* new HttpError({ status: 404, message: "Lesson not found" });
        }
        return serializeLesson(lesson);
      }, adaptAdminErrors),
    )
    .handle(
      "deleteLesson",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        const lesson = yield* Lessons.use((lessonService) =>
          lessonService.deleteLesson(params.id).pipe(withAuthContext(auth.session.id)),
        );
        if (!lesson) {
          return yield* new HttpError({ status: 404, message: "Lesson not found" });
        }
        return { success: true as const };
      }, adaptAdminErrors),
    )
    .handle(
      "cancelLesson",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const lesson = yield* Lessons.use((lessonService) =>
          lessonService
            .cancelLesson(params.id, payload.reason ?? null)
            .pipe(withAuthContext(auth.session.id)),
        );
        return serializeLesson(lesson);
      }, adaptAdminErrors),
    )
    .handle(
      "completeLesson",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const lesson = yield* Lessons.use((lessonService) =>
          lessonService.completeLesson(params.id).pipe(withAuthContext(auth.session.id)),
        );
        return serializeLesson(lesson);
      }, adaptAdminErrors),
    )
    .handle(
      "lessons",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
        const lessons = yield* Lessons.use((lessonService) =>
          lessonService
            .listLessons({
              limit: query.limit ?? 50,
              offset: query.offset ?? 0,
              studentId: query.student_id,
              status: query.status,
              from: query.from ? new Date(query.from) : undefined,
              to: query.to ? new Date(query.to) : undefined,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return lessons.map(serializeLesson);
      }, adaptAdminErrors),
    )
    .handle(
      "saveLessonNote",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const note = yield* Lessons.use((lessonService) =>
          lessonService
            .saveLessonNote(params.id, {
              topicsCovered: payload.topics_covered ?? null,
              homework: payload.homework ?? null,
              progressObservations: payload.progress_observations ?? null,
              notes: payload.notes ?? null,
              materialIds: payload.material_ids ? [...payload.material_ids] : null,
              draft: payload.draft ?? true,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return serializeLessonNote(note);
      }, adaptAdminErrors),
    )
    .handle(
      "lessonNote",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        const note = yield* Lessons.use((lessonService) =>
          lessonService.getLessonNote(params.id).pipe(withAuthContext(auth.session.id)),
        );
        if (!note) {
          return yield* new HttpError({ status: 404, message: "Lesson note not found" });
        }
        return serializeLessonNote(note);
      }, adaptAdminErrors),
    )
    .handle(
      "publishLessonNote",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        const note = yield* Lessons.use((lessonService) =>
          lessonService.publishLessonNote(params.id).pipe(withAuthContext(auth.session.id)),
        );
        if (!note) {
          return yield* new HttpError({ status: 404, message: "Lesson note not found" });
        }
        return serializeLessonNote(note);
      }, adaptAdminErrors),
    )
    .handle(
      "workingHours",
      Effect.fnUntraced(function* () {
        return yield* GoogleCalendar.use((googleCalendarService) =>
          googleCalendarService.getWorkingHours(),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "cancellationPolicySettings",
      Effect.fnUntraced(function* () {
        return yield* LessonPolicy.use((lessonPolicyService) => lessonPolicyService.getSettings());
      }, adaptAdminErrors),
    )
    .handle(
      "saveCancellationPolicySettings",
      Effect.fnUntraced(function* ({ payload }) {
        return yield* LessonPolicy.use((lessonPolicyService) =>
          lessonPolicyService.saveSettings(payload),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "saveWorkingHours",
      Effect.fnUntraced(function* ({ payload }) {
        yield* GoogleCalendar.use((googleCalendarService) =>
          googleCalendarService.setWorkingHours(payload),
        );
        return { success: true as const };
      }, adaptAdminErrors),
    ),
);
