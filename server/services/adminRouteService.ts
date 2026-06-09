import { Effect, Option } from "effect";
import * as S from "effect/Schema";
import { sql } from "kysely";
import { extractMaterialIds } from "../../shared/content.js";
import { EnrolledCourse, AssignedMaterial } from "../../shared/schemas.js";
import type { LessonStatus, LocationType } from "../../shared/schemas.js";
import { PgRootDB, withAuthContext } from "../db.js";
import { catchPgErrors, HttpError } from "../pgErrors.js";
import { GoogleCalendarService } from "./googleCalendarService.js";
import { NotationService } from "./notationService.js";
const lessonColumns = [
  "id",
  "student_id",
  "gcal_event_id",
  "scheduled_at",
  "duration_minutes",
  "location_type",
  "status",
  "cancellation_reason",
  "cancelled_at",
  "completed_at",
  "created_at",
] as const;
const lessonNoteColumns = [
  "id",
  "lesson_id",
  "topics_covered",
  "homework",
  "progress_observations",
  "notes",
  "material_ids",
  "draft",
  "created_at",
  "updated_at",
] as const;

export class AdminRouteService extends Effect.Service<AdminRouteService>()("AdminRouteService", {
  accessors: true,
  effect: Effect.gen(function* () {
    const rootDb = yield* PgRootDB;

    return {
      listSubmissions: Effect.fn("listSubmissions")(function* (limit: number, offset: number) {
        return yield* rootDb
          .selectFrom("app_public.contact_submissions")
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(limit)
          .offset(offset);
      }),

      updateSubmissionRead: Effect.fn("updateSubmissionRead")(function* (
        id: string,
        isRead: boolean,
      ) {
        return yield* rootDb
          .updateTable("app_public.contact_submissions")
          .set({ is_read: isRead })
          .where("id", "=", id)
          .returning(["id"])
          .pipe(Effect.head);
      }),

      listStudents: Effect.fn("listStudents")(function* () {
        return yield* rootDb
          .selectFrom("app_public.users")
          .select(["id", "username", "name", "role", "is_verified"])
          .select((eb) =>
            eb
              .selectFrom("app_public.user_emails")
              .select("email")
              .whereRef("app_public.user_emails.user_id", "=", "app_public.users.id")
              .where("is_primary", "=", true)
              .limit(1)
              .as("email"),
          )
          .where("role", "=", "student");
      }),

      getStudent: Effect.fn("getStudent")(function* (studentId: string) {
        const row = yield* rootDb
          .with("s", (qb) =>
            qb
              .selectFrom("app_public.users")
              .select(["id", "username", "name", "role", "is_verified"])
              .select((eb) =>
                eb
                  .selectFrom("app_public.user_emails")
                  .select("email")
                  .whereRef("app_public.user_emails.user_id", "=", "app_public.users.id")
                  .where("is_primary", "=", true)
                  .limit(1)
                  .as("email"),
              )
              .where("id", "=", studentId)
              .where("role", "=", "student"),
          )
          .with("c", (qb) =>
            qb
              .selectFrom("app_public.enrollments as e")
              .innerJoin("app_public.courses as c", "c.id", "e.course_id")
              .where("e.student_id", "=", studentId)
              .select(["c.id", "c.title", "c.instrument"]),
          )
          .with("m", (qb) =>
            qb
              .selectFrom("app_public.student_materials as sm")
              .innerJoin("app_public.materials as m", "m.id", "sm.material_id")
              .where("sm.student_id", "=", studentId)
              .select([
                "m.id",
                "m.title",
                "m.original_filename",
                "m.mime_type",
                "m.file_size",
                "m.is_global",
                "m.notation_tracks",
                "sm.assigned_track_index",
              ]),
          )
          .selectFrom("s")
          .selectAll("s")
          .select((eb) => [
            eb.fn
              .coalesce(
                eb.selectFrom("c").select(eb.fn.jsonAgg(eb.fn("row_to_json", [sql`c.*`])).as("_")),
                sql`'[]'::json`,
              )
              .as("enrolled_courses"),
            eb.fn
              .coalesce(
                eb.selectFrom("m").select(eb.fn.jsonAgg(eb.fn("row_to_json", [sql`m.*`])).as("_")),
                sql`'[]'::json`,
              )
              .as("assigned_materials"),
          ])
          .pipe(
            Effect.head,
            Effect.catchTag(
              "NoSuchElementException",
              () => new HttpError(404, "Student not found"),
            ),
          );

        const enrolledCourses = yield* S.decodeUnknown(S.Array(EnrolledCourse))(
          row.enrolled_courses,
        );
        const assignedMaterials = yield* S.decodeUnknown(S.Array(AssignedMaterial))(
          row.assigned_materials,
        );

        return {
          ...row,
          enrolled_courses: enrolledCourses,
          assigned_materials: assignedMaterials,
        };
      }),

      listCourses: Effect.fn("listCourses")(function* () {
        return yield* rootDb
          .selectFrom("app_public.courses")
          .select(["id", "title", "description", "instrument"]);
      }),

      listCourseStudents: Effect.fn("listCourseStudents")(function* (courseId: string) {
        return yield* rootDb
          .selectFrom("app_public.enrollments as e")
          .innerJoin("app_public.users as u", "u.id", "e.student_id")
          .where("e.course_id", "=", courseId)
          .select(["u.id", "u.username", "u.name", "u.role", "u.is_verified"])
          .select((eb) =>
            eb
              .selectFrom("app_public.user_emails")
              .select("email")
              .whereRef("app_public.user_emails.user_id", "=", "u.id")
              .where("is_primary", "=", true)
              .as("email"),
          );
      }),

      createCourse: Effect.fn("createCourse")(function* (values: {
        title: string;
        description: string;
        instrument: string;
      }) {
        return yield* rootDb
          .insertInto("app_public.courses")
          .values(values)
          .returning(["id", "title", "description", "instrument"])
          .pipe(Effect.head);
      }),

      updateCourse: Effect.fn("updateCourse")(function* (
        id: string,
        updates: Partial<{
          title: string;
          description: string;
          instrument: string;
        }>,
      ) {
        return yield* rootDb
          .updateTable("app_public.courses")
          .set(updates)
          .where("id", "=", id)
          .returning(["id", "title", "description", "instrument"])
          .pipe(Effect.head, Effect.option, Effect.map(Option.getOrUndefined));
      }),

      deleteCourse: Effect.fn("deleteCourse")(function* (id: string) {
        yield* rootDb.deleteFrom("app_public.courses").where("id", "=", id);
      }),

      getModule: Effect.fn("getModule")(function* (id: string) {
        return yield* rootDb
          .selectFrom("app_public.modules")
          .select(["id", "course_id", "title", "content", "sort_order"])
          .where("id", "=", id)
          .pipe(Effect.head);
      }),

      createModule: Effect.fn("createModule")(function* (
        courseId: string,
        values: {
          title: string;
          sort_order: number;
        },
      ) {
        return yield* rootDb
          .insertInto("app_public.modules")
          .values({
            course_id: courseId,
            title: values.title,
            sort_order: values.sort_order,
          })
          .returning(["id", "course_id", "title", "content", "sort_order"])
          .pipe(Effect.head);
      }),

      updateModule: Effect.fn("updateModule")(function* (
        id: string,
        updates: {
          title?: string;
          sort_order?: number;
          content?: unknown;
        },
      ) {
        const moduleUpdates: Record<string, unknown> = {};
        if (updates.title !== undefined) {
          moduleUpdates.title = updates.title;
        }
        if (updates.content !== undefined) {
          moduleUpdates.content = updates.content ? JSON.stringify(updates.content) : null;
        }
        if (updates.sort_order !== undefined) {
          moduleUpdates.sort_order = updates.sort_order;
        }
        const mod = yield* rootDb
          .updateTable("app_public.modules")
          .set(moduleUpdates)
          .where("id", "=", id)
          .returning(["id", "course_id", "title", "content", "sort_order"])
          .pipe(Effect.head);
        if (updates.content !== undefined) {
          const materialIds = extractMaterialIds(updates.content);
          if (materialIds.length > 0) {
            yield* rootDb
              .deleteFrom("app_public.module_materials")
              .where("module_id", "=", id)
              .where("material_id", "not in", materialIds);
          } else {
            yield* rootDb.deleteFrom("app_public.module_materials").where("module_id", "=", id);
          }
          if (materialIds.length > 0) {
            yield* rootDb
              .insertInto("app_public.module_materials")
              .values(
                materialIds.map((materialId, index) => ({
                  module_id: id,
                  material_id: materialId,
                  sort_order: index,
                })),
              )
              .onConflict((oc) => oc.doNothing());
          }
        }
        return mod;
      }),

      deleteModule: Effect.fn("deleteModule")(function* (id: string) {
        yield* rootDb.deleteFrom("app_public.modules").where("id", "=", id);
      }),

      enrollStudent: Effect.fn("enrollStudent")(function* (studentId: string, courseId: string) {
        yield* rootDb
          .insertInto("app_public.enrollments")
          .values({
            student_id: studentId,
            course_id: courseId,
          })
          .onConflict((oc) => oc.doNothing());
      }),

      unenrollStudent: Effect.fn("unenrollStudent")(function* (
        studentId: string,
        courseId: string,
      ) {
        yield* rootDb
          .deleteFrom("app_public.enrollments")
          .where("student_id", "=", studentId)
          .where("course_id", "=", courseId);
      }),

      assignMaterial: Effect.fn("assignMaterial")(function* (values: {
        studentId: string;
        materialId: string;
        assignedTrackIndex: number | string | null | undefined;
      }) {
        const resolvedTrackIndex = yield* NotationService.resolveAssignedTrackIndex(
          values.materialId,
          values.assignedTrackIndex,
        );
        yield* rootDb
          .insertInto("app_public.student_materials")
          .values({
            student_id: values.studentId,
            material_id: values.materialId,
            assigned_track_index: resolvedTrackIndex,
          })
          .onConflict((oc) =>
            oc.columns(["student_id", "material_id"]).doUpdateSet({
              assigned_track_index: resolvedTrackIndex,
            }),
          );
      }),

      unassignMaterial: Effect.fn("unassignMaterial")(function* (
        studentId: string,
        materialId: string,
      ) {
        yield* rootDb
          .deleteFrom("app_public.student_materials")
          .where("student_id", "=", studentId)
          .where("material_id", "=", materialId);
      }),

      deleteMaterial: Effect.fn("deleteMaterial")(function* (id: string) {
        return yield* rootDb
          .deleteFrom("app_public.materials")
          .where("id", "=", id)
          .returning("id")
          .pipe(Effect.head);
      }),

      createFamily: Effect.fn("createFamily")(function* (
        sessionId: string,
        values: {
          slug: string;
          name: string;
        },
      ) {
        return yield* withAuthContext(sessionId, (trx) =>
          trx
            .selectFrom((eb) =>
              eb
                .fn<{
                  id: string;
                  slug: string;
                  name: string;
                  description: string | null;
                  created_at: Date;
                }>("app_public.create_family", [eb.val(values.slug), eb.val(values.name)])
                .as("f"),
            )
            .selectAll(),
        )
          .pipe(Effect.orElseFail(() => new HttpError(500, "Failed to create family")))
          .pipe(catchPgErrors);
      }),

      listFamilies: Effect.fn("listFamilies")(function* () {
        return yield* rootDb
          .selectFrom("app_public.families")
          .select(["id", "slug", "name", "description", "created_at"])
          .orderBy("created_at", "desc");
      }),

      inviteFamily: Effect.fn("inviteFamily")(function* (
        sessionId: string,
        familyId: string,
        values: {
          username?: string;
          email?: string;
        },
      ) {
        yield* withAuthContext(sessionId, (trx) =>
          trx.selectNoFrom((eb) =>
            eb
              .fn<unknown>("app_public.invite_to_family", [
                eb.val(familyId),
                eb.val(values.username ?? null),
                eb.val(values.email ?? null),
              ])
              .as("invite_to_family"),
          ),
        ).pipe(catchPgErrors);
      }),

      createQrInviteFamily: Effect.fn("createQrInviteFamily")(function* (values: {
        name: string;
        slug: string;
      }) {
        return yield* rootDb
          .insertInto("app_public.families")
          .values(values)
          .returning(["id"])
          .pipe(Effect.head, catchPgErrors);
      }),

      createQrInvite: Effect.fn("createQrInvite")(function* (familyId: string) {
        return yield* rootDb
          .selectFrom((eb) =>
            eb
              .fn<{
                id: string;
                code: string;
                expires_at: Date;
              }>("app_private.create_qr_invite", [eb.val(familyId)])
              .as("i"),
          )
          .select(["id", "code", "expires_at"])
          .pipe(
            catchPgErrors,
            Effect.head,
            Effect.catchTag(
              "NoSuchElementException",
              () => new HttpError(500, "Failed to create QR invite"),
            ),
          );
      }),

      listFamilyInvitations: Effect.fn("listFamilyInvitations")(function* (familyId: string) {
        return yield* rootDb
          .selectFrom("app_public.family_invitations as fi")
          .innerJoin("app_public.families as f", "f.id", "fi.family_id")
          .select([
            "fi.id",
            "fi.family_id",
            "f.name as family_name",
            "fi.code",
            "fi.user_id",
            "fi.email",
          ])
          .where("fi.family_id", "=", familyId);
      }),

      createLesson: Effect.fn("createLesson")(function* (values: {
        studentId: string;
        scheduledAt: Date;
        durationMinutes: number;
        locationType: LocationType;
        gcalEventId: string | null;
      }) {
        const lesson = yield* rootDb
          .insertInto("app_public.lessons")
          .values({
            student_id: values.studentId,
            scheduled_at: values.scheduledAt,
            duration_minutes: values.durationMinutes,
            location_type: values.locationType,
            gcal_event_id: values.gcalEventId,
          })
          .returning(lessonColumns)
          .pipe(Effect.head);
        const connected = yield* GoogleCalendarService.isConnected();
        if (connected && lesson.scheduled_at) {
          const student = yield* rootDb
            .selectFrom("app_public.users")
            .select(["name"])
            .where("id", "=", lesson.student_id)
            .pipe(Effect.head, Effect.option);
          const studentName = Option.getOrNull(student)?.name ?? "Student";
          const startTime = new Date(String(lesson.scheduled_at));
          const endTime = new Date(startTime.getTime() + lesson.duration_minutes * 60000);
          const eventId = yield* GoogleCalendarService.createEvent({
            summary: `Lesson: ${studentName}`,
            description: `${lesson.duration_minutes} min ${lesson.location_type.replace(/_/g, " ")} lesson`,
            start: startTime.toISOString(),
            end: endTime.toISOString(),
          }).pipe(Effect.catchAll(() => Effect.succeed(null)));
          if (eventId) {
            yield* rootDb
              .updateTable("app_public.lessons")
              .set({ gcal_event_id: eventId })
              .where("id", "=", lesson.id);
            return { ...lesson, gcal_event_id: eventId };
          }
        }
        return lesson;
      }),

      updateLesson: Effect.fn("updateLesson")(function* (
        id: string,
        updates: {
          scheduledAt?: Date;
          durationMinutes?: number;
          locationType?: LocationType;
          status?: LessonStatus;
          cancellationReason?: string;
        },
      ) {
        const lessonUpdates: Record<string, unknown> = {};
        if (updates.scheduledAt !== undefined) {
          lessonUpdates.scheduled_at = updates.scheduledAt;
        }
        if (updates.durationMinutes !== undefined) {
          lessonUpdates.duration_minutes = updates.durationMinutes;
        }
        if (updates.locationType !== undefined) {
          lessonUpdates.location_type = updates.locationType;
        }
        if (updates.status !== undefined) {
          lessonUpdates.status = updates.status;
          if (updates.status === "cancelled") {
            lessonUpdates.cancelled_at = new Date();
          }
          if (updates.status === "completed") {
            lessonUpdates.completed_at = new Date();
          }
        }
        if (updates.cancellationReason !== undefined) {
          lessonUpdates.cancellation_reason = updates.cancellationReason;
        }
        const lesson = yield* rootDb
          .updateTable("app_public.lessons")
          .set(lessonUpdates)
          .where("id", "=", id)
          .returning(lessonColumns)
          .pipe(Effect.head);
        if (updates.status === "cancelled" && lesson.gcal_event_id) {
          yield* GoogleCalendarService.deleteEvent(lesson.gcal_event_id).pipe(Effect.ignore);
        }
        return lesson;
      }),

      deleteLesson: Effect.fn("deleteLesson")(function* (id: string) {
        const lesson = yield* rootDb
          .deleteFrom("app_public.lessons")
          .where("id", "=", id)
          .returning(["id", "gcal_event_id"])
          .pipe(Effect.head);
        if (lesson?.gcal_event_id) {
          yield* GoogleCalendarService.deleteEvent(lesson.gcal_event_id).pipe(Effect.ignore);
        }
        return lesson;
      }),

      listLessons: Effect.fn("listLessons")(function* (filters: {
        limit: number;
        offset: number;
        studentId?: string;
        status?: LessonStatus;
        from?: Date;
        to?: Date;
      }) {
        let query = rootDb
          .selectFrom("app_public.lessons")
          .select(lessonColumns)
          .orderBy("scheduled_at", "desc")
          .limit(filters.limit)
          .offset(filters.offset);
        if (filters.studentId) {
          query = query.where("student_id", "=", filters.studentId);
        }
        if (filters.status) {
          query = query.where("status", "=", filters.status);
        }
        if (filters.from) {
          query = query.where("scheduled_at", ">=", filters.from);
        }
        if (filters.to) {
          query = query.where("scheduled_at", "<=", filters.to);
        }
        return yield* query;
      }),

      saveStudentRate: Effect.fn("saveStudentRate")(function* (values: {
        studentId: string;
        rateCents: number;
        lessonDurationMinutes: number;
        locationType: LocationType;
        notes: string | null;
      }) {
        return yield* rootDb
          .insertInto("app_public.student_rates")
          .values({
            student_id: values.studentId,
            rate_cents: values.rateCents,
            lesson_duration_minutes: values.lessonDurationMinutes,
            location_type: values.locationType,
            notes: values.notes,
          })
          .onConflict((oc) =>
            oc.columns(["student_id", "location_type"]).doUpdateSet({
              rate_cents: values.rateCents,
              lesson_duration_minutes: values.lessonDurationMinutes,
              notes: values.notes,
            }),
          )
          .returning([
            "id",
            "student_id",
            "rate_cents",
            "lesson_duration_minutes",
            "location_type",
            "notes",
            "created_at",
          ])
          .pipe(Effect.head);
      }),

      listStudentRates: Effect.fn("listStudentRates")(function* (
        studentId: string,
        locationType?: LocationType,
      ) {
        let query = rootDb
          .selectFrom("app_public.student_rates")
          .select([
            "id",
            "student_id",
            "rate_cents",
            "lesson_duration_minutes",
            "location_type",
            "notes",
            "created_at",
          ])
          .where("student_id", "=", studentId);
        if (locationType) {
          query = query.where("location_type", "=", locationType);
        }
        return yield* query;
      }),

      saveLessonNote: Effect.fn("saveLessonNote")(function* (
        lessonId: string,
        values: {
          topicsCovered: string | null;
          homework: string | null;
          progressObservations: string | null;
          notes: string | null;
          materialIds: string[] | null;
          draft: boolean;
        },
      ) {
        return yield* rootDb
          .insertInto("app_public.lesson_notes")
          .values({
            lesson_id: lessonId,
            topics_covered: values.topicsCovered,
            homework: values.homework,
            progress_observations: values.progressObservations,
            notes: values.notes,
            material_ids: values.materialIds,
            draft: values.draft,
          })
          .onConflict((oc) =>
            oc.column("lesson_id").doUpdateSet({
              topics_covered: values.topicsCovered,
              homework: values.homework,
              progress_observations: values.progressObservations,
              notes: values.notes,
              material_ids: values.materialIds,
              draft: values.draft,
            }),
          )
          .returning(lessonNoteColumns)
          .pipe(Effect.head);
      }),

      getLessonNote: Effect.fn("getLessonNote")(function* (lessonId: string) {
        return yield* rootDb
          .selectFrom("app_public.lesson_notes")
          .select(lessonNoteColumns)
          .where("lesson_id", "=", lessonId)
          .pipe(Effect.head);
      }),

      publishLessonNote: Effect.fn("publishLessonNote")(function* (lessonId: string) {
        return yield* rootDb
          .updateTable("app_public.lesson_notes")
          .set({ draft: false })
          .where("lesson_id", "=", lessonId)
          .returning(lessonNoteColumns)
          .pipe(Effect.head);
      }),

      getGoogleCalendarStatus: Effect.fn("getGoogleCalendarStatus")(function* () {
        const rows = yield* rootDb
          .selectFrom("app_private.admin_settings")
          .select(["key", "value"])
          .where("key", "in", ["gcal_refresh_token", "gcal_calendar_id"]);
        const token = rows.find((r) => r.key === "gcal_refresh_token");
        const calendar = rows.find((r) => r.key === "gcal_calendar_id");
        return {
          connected: !!token,
          calendar_id: calendar?.value ?? null,
        };
      }),

      disconnectGoogleCalendar: Effect.fn("disconnectGoogleCalendar")(function* () {
        yield* rootDb
          .deleteFrom("app_private.admin_settings")
          .where("key", "in", [
            "gcal_refresh_token",
            "gcal_access_token",
            "gcal_access_token_expires_at",
            "gcal_calendar_id",
            "gcal_sync_token",
          ]);
      }),

      getWorkingHours: Effect.fn("getWorkingHours")(function* () {
        return yield* rootDb
          .selectFrom("app_private.admin_settings")
          .select("value")
          .where("key", "=", "working_hours")
          .pipe(
            Effect.head,
            Effect.map((setting) => setting?.value ?? null),
          );
      }),

      saveWorkingHours: Effect.fn("saveWorkingHours")(function* (workingHours: unknown) {
        yield* rootDb
          .insertInto("app_private.admin_settings")
          .values({ key: "working_hours", value: JSON.stringify(workingHours) })
          .onConflict((oc) =>
            oc.column("key").doUpdateSet({ value: JSON.stringify(workingHours) }),
          );
      }),

      updateTestimonialApproval: Effect.fn("updateTestimonialApproval")(function* (
        testimonialId: string,
        isApproved: boolean,
      ) {
        return yield* rootDb
          .with("updated", (qb) =>
            qb
              .updateTable("app_public.testimonials")
              .set({ is_approved: isApproved })
              .where("id", "=", testimonialId)
              .returning(["id", "user_id", "is_approved"]),
          )
          .selectFrom("updated")
          .innerJoin("app_public.users as u", "u.id", "updated.user_id")
          .select(["updated.id", "updated.user_id", "updated.is_approved", "u.role"])
          .pipe(
            Effect.head,
            Effect.option,
            Effect.flatMap(
              Option.match({
                onNone: () => HttpError.make(404, "Testimonial not found"),
                onSome: Effect.succeed,
              }),
            ),
          );
      }),
    };
  }),
}) {}
