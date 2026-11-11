import { Effect, Option, Context, Layer } from "effect";
import * as S from "effect/Schema";
import { sql } from "kysely";
import { extractMaterialIds } from "../../shared/content.js";
import { EnrolledCourse, AssignedMaterial, Module } from "../../shared/schemas.js";
import type {
  BillingModel,
  LessonStatus,
  LocationType,
  RichTextDocument,
} from "../../shared/schemas.js";
import { PgRootDB, withAuthContext } from "../db.js";
import { catchPgErrors, HttpError } from "../pgErrors.js";
import { GoogleCalendarService } from "./googleCalendarService.js";
import { settleSingleBookingCancellation, singleBookingObligation } from "./singleBookingBills.js";
import { LessonPolicyService } from "./lessonPolicyService.js";
import { resolveAssignedTrackIndex } from "./notationService.js";
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
  "cancellation_fee_cents",
  "remainder_due_cents",
  sql<string | null>`recurring_schedule_id`.as("recurring_schedule_id"),
  "recurrence_date",
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

export class AdminRouteService extends Context.Service<AdminRouteService>()("AdminRouteService", {
  make: Effect.gen(function* () {
    const rootDb = yield* PgRootDB;
    const lessonPolicy = yield* LessonPolicyService;

    return {
      listSubmissions: Effect.fn("listSubmissions")(function* (
        sessionId: string,
        limit: number,
        offset: number,
      ) {
        return yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
              .selectFrom("app_public.contact_submissions")
              .selectAll()
              .orderBy("created_at", "desc")
              .limit(limit)
              .offset(offset),
          ),
        );
      }),

      updateSubmissionRead: Effect.fn("updateSubmissionRead")(function* (
        sessionId: string,
        id: string,
        isRead: boolean,
      ) {
        return yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
                .updateTable("app_public.contact_submissions")
                .set({ is_read: isRead })
                .where("id", "=", id)
                .returning(["id"]),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(404, "Contact submission not found"),
              }),
            ),
        );
      }),

      listStudents: Effect.fn("listStudents")(function* (sessionId: string) {
        return yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
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
              .where("role", "=", "student"),
          ),
        );
      }),

      getStudent: Effect.fn("getStudent")(function* (sessionId: string, studentId: string) {
        const row = yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
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
                    .leftJoin("app_public.assignment_progress as ap", (join) =>
                      join
                        .onRef("ap.material_id", "=", "sm.material_id")
                        .onRef("ap.student_id", "=", "sm.student_id"),
                    )
                    .where("sm.student_id", "=", studentId)
                    .select((eb) => [
                      "m.id",
                      "m.title",
                      "m.original_filename",
                      "m.mime_type",
                      eb.cast("m.file_size", "integer").as("file_size"),
                      "m.is_global",
                      "m.notation_tracks",
                      "sm.assigned_track_index",
                      eb.fn.coalesce("ap.listened_seconds", eb.val(0)).as("listened_seconds"),
                    ]),
                )
                .selectFrom("s")
                .selectAll("s")
                .select((eb) => [
                  eb.fn
                    .coalesce(
                      eb
                        .selectFrom("c")
                        .select(eb.fn.jsonAgg(eb.fn("row_to_json", [sql`c.*`])).as("_")),
                      sql`'[]'::json`,
                    )
                    .as("enrolled_courses"),
                  eb.fn
                    .coalesce(
                      eb
                        .selectFrom("m")
                        .select(eb.fn.jsonAgg(eb.fn("row_to_json", [sql`m.*`])).as("_")),
                      sql`'[]'::json`,
                    )
                    .as("assigned_materials"),
                ]),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(404, "Student not found"),
              }),
            ),
        );

        const enrolledCourses = yield* S.decodeUnknownEffect(S.Array(EnrolledCourse))(
          row.enrolled_courses,
        );
        const assignedMaterials = yield* S.decodeUnknownEffect(S.Array(AssignedMaterial))(
          row.assigned_materials,
        );

        return {
          ...row,
          enrolled_courses: enrolledCourses,
          assigned_materials: assignedMaterials,
        };
      }),

      listCourses: Effect.fn("listCourses")(function* (sessionId: string) {
        return yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
              .selectFrom("app_public.courses")
              .select(["id", "title", "description", "instrument"]),
          ),
        );
      }),

      listCourseStudents: Effect.fn("listCourseStudents")(function* (
        sessionId: string,
        courseId: string,
      ) {
        return yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
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
              ),
          ),
        );
      }),

      createCourse: Effect.fn("createCourse")(function* (
        sessionId: string,
        values: {
          title: string;
          description: string;
          instrument: string;
        },
      ) {
        return yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
                .insertInto("app_public.courses")
                .values(values)
                .returning(["id", "title", "description", "instrument"]),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(500, "Failed to create course"),
              }),
            ),
        );
      }),

      updateCourse: Effect.fn("updateCourse")(function* (
        sessionId: string,
        id: string,
        updates: Partial<{
          title: string;
          description: string;
          instrument: string;
        }>,
      ) {
        return yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
                .updateTable("app_public.courses")
                .set(updates)
                .where("id", "=", id)
                .returning(["id", "title", "description", "instrument"]),
            )
            .pipe(Effect.head, Effect.option, Effect.map(Option.getOrUndefined)),
        );
      }),

      deleteCourse: Effect.fn("deleteCourse")(function* (sessionId: string, id: string) {
        yield* withAuthContext(sessionId, (db) =>
          db.execute(db.deleteFrom("app_public.courses").where("id", "=", id)),
        );
      }),

      getModule: Effect.fn("getModule")(function* (sessionId: string, id: string) {
        return yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
                .selectFrom("app_public.modules")
                .select(["id", "course_id", "title", "content", "sort_order"])
                .where("id", "=", id),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(404, "Module not found"),
              }),
              Effect.flatMap(S.decodeUnknownEffect(Module)),
            ),
        );
      }),

      createModule: Effect.fn("createModule")(function* (
        sessionId: string,
        courseId: string,
        values: {
          title: string;
          sort_order: number;
        },
      ) {
        return yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
                .insertInto("app_public.modules")
                .values({
                  course_id: courseId,
                  title: values.title,
                  sort_order: values.sort_order,
                })
                .returning(["id", "course_id", "title", "content", "sort_order"]),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(500, "Failed to create module"),
              }),
              Effect.flatMap(S.decodeUnknownEffect(Module)),
            ),
        );
      }),

      updateModule: Effect.fn("updateModule")(function* (
        sessionId: string,
        id: string,
        updates: {
          title?: string;
          sort_order?: number;
          content?: RichTextDocument | null;
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
        return yield* withAuthContext(
          sessionId,
          Effect.fnUntraced(function* (db) {
            const mod = yield* db
              .execute(
                db
                  .updateTable("app_public.modules")
                  .set(moduleUpdates)
                  .where("id", "=", id)
                  .returning(["id", "course_id", "title", "content", "sort_order"]),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () => new HttpError(404, "Module not found"),
                }),
                Effect.flatMap(S.decodeUnknownEffect(Module)),
              );
            if (updates.content !== undefined) {
              const materialIds =
                updates.content === null ? [] : extractMaterialIds(updates.content);
              if (materialIds.length > 0) {
                yield* db.execute(
                  db
                    .deleteFrom("app_public.module_materials")
                    .where("module_id", "=", id)
                    .where("material_id", "not in", materialIds),
                );
              } else {
                yield* db.execute(
                  db.deleteFrom("app_public.module_materials").where("module_id", "=", id),
                );
              }
              if (materialIds.length > 0) {
                yield* db.execute(
                  db
                    .insertInto("app_public.module_materials")
                    .values(
                      materialIds.map((materialId, index) => ({
                        module_id: id,
                        material_id: materialId,
                        sort_order: index,
                      })),
                    )
                    .onConflict((oc) => oc.doNothing()),
                );
              }
            }
            return mod;
          }),
        );
      }),

      deleteModule: Effect.fn("deleteModule")(function* (sessionId: string, id: string) {
        yield* withAuthContext(sessionId, (db) =>
          db.execute(db.deleteFrom("app_public.modules").where("id", "=", id)),
        );
      }),

      enrollStudent: Effect.fn("enrollStudent")(function* (
        sessionId: string,
        studentId: string,
        courseId: string,
      ) {
        yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
              .insertInto("app_public.enrollments")
              .values({
                student_id: studentId,
                course_id: courseId,
              })
              .onConflict((oc) => oc.doNothing()),
          ),
        );
      }),

      unenrollStudent: Effect.fn("unenrollStudent")(function* (
        sessionId: string,
        studentId: string,
        courseId: string,
      ) {
        yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
              .deleteFrom("app_public.enrollments")
              .where("student_id", "=", studentId)
              .where("course_id", "=", courseId),
          ),
        );
      }),

      assignMaterial: Effect.fn("assignMaterial")(function* (values: {
        sessionId: string;
        studentId: string;
        materialId: string;
        assignedTrackIndex: number | string | null | undefined;
      }) {
        const resolvedTrackIndex = yield* resolveAssignedTrackIndex(
          values.sessionId,
          values.materialId,
          values.assignedTrackIndex,
        );
        yield* withAuthContext(values.sessionId, (db) =>
          db.execute(
            db
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
              ),
          ),
        );
      }),

      unassignMaterial: Effect.fn("unassignMaterial")(function* (
        sessionId: string,
        studentId: string,
        materialId: string,
      ) {
        yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
              .deleteFrom("app_public.student_materials")
              .where("student_id", "=", studentId)
              .where("material_id", "=", materialId),
          ),
        );
      }),

      deleteMaterial: Effect.fn("deleteMaterial")(function* (sessionId: string, id: string) {
        return yield* withAuthContext(sessionId, (db) =>
          db
            .execute(db.deleteFrom("app_public.materials").where("id", "=", id).returning("id"))
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(404, "Material not found"),
              }),
            ),
        );
      }),

      createFamily: Effect.fn("createFamily")(function* (
        sessionId: string,
        values: {
          slug: string;
          name: string;
        },
      ) {
        return yield* withAuthContext(sessionId, (trx) =>
          trx.execute(
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
          ),
        ).pipe(catchPgErrors);
      }),

      listFamilies: Effect.fn("listFamilies")(function* (sessionId: string) {
        return yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
              .selectFrom("app_public.families")
              .select(["id", "slug", "name", "description", "created_at"])
              .orderBy("created_at", "desc"),
          ),
        );
      }),

      inviteFamily: Effect.fn("inviteFamily")(function* (
        sessionId: string,
        familyId: string,
        values: {
          username?: string;
          email?: string;
          invitedRole?: string;
        },
      ) {
        yield* withAuthContext(sessionId, (trx) =>
          trx.execute(
            trx.selectNoFrom((eb) =>
              eb
                .fn<unknown>("app_public.invite_to_family", [
                  eb.val(familyId),
                  eb.val(values.username ?? null),
                  eb.val(values.email ?? null),
                  eb.val(values.invitedRole ?? "parent"),
                ])
                .as("invite_to_family"),
            ),
          ),
        ).pipe(catchPgErrors);
      }),

      createQrInviteFamily: Effect.fn("createQrInviteFamily")(function* (
        sessionId: string,
        values: {
          name: string;
          slug: string;
        },
      ) {
        return yield* withAuthContext(sessionId, (db) =>
          db.execute(db.insertInto("app_public.families").values(values).returning(["id"])).pipe(
            Effect.head,
            Effect.catchTags({
              NoSuchElementError: () => new HttpError(500, "Failed to create family"),
            }),
            catchPgErrors,
          ),
        );
      }),

      createQrInvite: Effect.fn("createQrInvite")(function* (
        familyId: string,
        invitedRole?: string,
      ) {
        return yield* rootDb
          .execute(
            rootDb
              .selectFrom((eb) =>
                eb
                  .fn<{
                    id: string;
                    code: string;
                    expires_at: Date;
                  }>("app_private.create_qr_invite", [
                    eb.val(familyId),
                    eb.val(invitedRole ?? "parent"),
                  ])
                  .as("i"),
              )
              .select(["id", "code", "expires_at"]),
          )
          .pipe(
            catchPgErrors,
            Effect.head,
            Effect.catchTags({
              NoSuchElementError: () => new HttpError(500, "Failed to create QR invite"),
            }),
          );
      }),

      listFamilyInvitations: Effect.fn("listFamilyInvitations")(function* (
        sessionId: string,
        familyId: string,
      ) {
        return yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
              .selectFrom("app_public.family_invitations as fi")
              .innerJoin("app_public.families as f", "f.id", "fi.family_id")
              .select([
                "fi.id",
                "fi.family_id",
                "f.name as family_name",
                "fi.code",
                "fi.user_id",
                "fi.email",
                "fi.invited_role",
              ])
              .where("fi.family_id", "=", familyId),
          ),
        );
      }),

      createLesson: Effect.fn("createLesson")(function* (values: {
        sessionId: string;
        studentId: string;
        scheduledAt: Date;
        durationMinutes: number;
        locationType: LocationType;
        gcalEventId: string | null;
      }) {
        const lesson = yield* withAuthContext(
          values.sessionId,
          Effect.fnUntraced(function* (db) {
            const created = yield* db
              .execute(
                db
                  .insertInto("app_public.lessons")
                  .values({
                    student_id: values.studentId,
                    scheduled_at: values.scheduledAt,
                    duration_minutes: values.durationMinutes,
                    location_type: values.locationType,
                    gcal_event_id: values.gcalEventId,
                  })
                  .returning(lessonColumns),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () => new HttpError(500, "Failed to create lesson"),
                }),
              );
            // A lesson the admin schedules is billed like a booked one, but holds no deposit.
            yield* db.execute(singleBookingObligation(db, created.id));
            return created;
          }),
        ).pipe(catchPgErrors);
        const connected = yield* GoogleCalendarService.use((googleCalendarService) =>
          googleCalendarService.isConnected(),
        );
        if (connected && lesson.scheduled_at) {
          const student = yield* withAuthContext(values.sessionId, (db) =>
            db
              .execute(
                db
                  .selectFrom("app_public.users")
                  .select(["name"])
                  .where("id", "=", lesson.student_id),
              )
              .pipe(Effect.head, Effect.option),
          );
          const studentName = Option.getOrNull(student)?.name ?? "Student";
          const startTime = new Date(String(lesson.scheduled_at));
          const endTime = new Date(startTime.getTime() + lesson.duration_minutes * 60000);
          const eventId = yield* GoogleCalendarService.use((googleCalendarService) =>
            googleCalendarService.createEvent({
              summary: `Lesson: ${studentName}`,
              description: `${lesson.duration_minutes} min ${lesson.location_type.replace(/_/g, " ")} lesson`,
              start: startTime.toISOString(),
              end: endTime.toISOString(),
            }),
          ).pipe(Effect.catch(() => Effect.succeed(null)));
          if (eventId) {
            yield* withAuthContext(values.sessionId, (db) =>
              db.execute(
                db
                  .updateTable("app_public.lessons")
                  .set({ gcal_event_id: eventId })
                  .where("id", "=", lesson.id),
              ),
            );
            return { ...lesson, gcal_event_id: eventId };
          }
        }
        return lesson;
      }),

      updateLesson: Effect.fn("updateLesson")(function* (
        sessionId: string,
        id: string,
        updates: {
          scheduledAt?: Date;
          durationMinutes?: number;
          locationType?: LocationType;
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
        const lesson = yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
                .updateTable("app_public.lessons")
                .set(lessonUpdates)
                .where("id", "=", id)
                .returning(lessonColumns),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(404, "Lesson not found"),
              }),
            ),
        );
        return lesson;
      }),

      deleteLesson: Effect.fn("deleteLesson")(function* (sessionId: string, id: string) {
        const lesson = yield* withAuthContext(
          sessionId,
          Effect.fnUntraced(function* (db) {
            // Deleting a lesson keeps its bill line (lesson_id becomes null), so
            // cancel the open bill while the line still names the lesson.
            yield* db.execute(settleSingleBookingCancellation(db, id));
            return yield* db
              .execute(
                db
                  .deleteFrom("app_public.lessons")
                  .where("id", "=", id)
                  .returning(["id", "gcal_event_id"]),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () => new HttpError(404, "Lesson not found"),
                }),
              );
          }),
        ).pipe(catchPgErrors);
        if (lesson.gcal_event_id) {
          const googleCalendarService = yield* GoogleCalendarService;
          yield* googleCalendarService.deleteEvent(lesson.gcal_event_id).pipe(Effect.ignore);
        }
        return lesson;
      }),

      cancelLesson: Effect.fn("cancelLesson")(function* (
        sessionId: string,
        id: string,
        reason: string | null,
      ) {
        const now = new Date();
        const result = yield* withAuthContext(
          sessionId,
          Effect.fnUntraced(function* (db) {
            const existing = yield* db
              .execute(
                db
                  .selectFrom("app_public.lessons")
                  .select(["id", "status", "gcal_event_id"])
                  .where("id", "=", id)
                  .forUpdate(),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () => new HttpError(404, "Lesson not found"),
                }),
              );
            if (existing.status !== "scheduled") {
              return yield* new HttpError(409, "Only scheduled lessons can be cancelled");
            }
            yield* db.execute(
              db
                .updateTable("app_public.lesson_deposits")
                .set({ status: "refunded" })
                .where("lesson_id", "=", existing.id)
                .where("status", "=", "held"),
            );
            yield* db.execute(settleSingleBookingCancellation(db, existing.id));
            const lesson = yield* db
              .execute(
                db
                  .updateTable("app_public.lessons")
                  .set({
                    status: "cancelled",
                    cancellation_reason: reason ?? "admin",
                    cancelled_at: now,
                    cancellation_fee_cents: 0,
                    remainder_due_cents: 0,
                  })
                  .where("id", "=", existing.id)
                  .returning(lessonColumns),
              )
              .pipe(Effect.head);
            return { lesson, gcalEventId: existing.gcal_event_id };
          }),
        );
        if (result.gcalEventId) {
          const googleCalendarService = yield* GoogleCalendarService;
          yield* googleCalendarService.deleteEvent(result.gcalEventId).pipe(Effect.ignore);
        }
        return result.lesson;
      }),

      completeLesson: Effect.fn("completeLesson")(function* (sessionId: string, id: string) {
        const now = new Date();
        return yield* withAuthContext(
          sessionId,
          Effect.fnUntraced(function* (db) {
            const existing = yield* db
              .execute(
                db
                  .selectFrom("app_public.lessons")
                  .select(["id", "student_id", "location_type", "status"])
                  .where("id", "=", id)
                  .forUpdate(),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () => new HttpError(404, "Lesson not found"),
                }),
              );
            if (existing.status !== "scheduled") {
              return yield* new HttpError(409, "Only scheduled lessons can be completed");
            }
            const rate = yield* db
              .execute(
                db
                  .selectFrom("app_public.student_rates")
                  .select(["rate_cents", "billing_model"])
                  .where("student_id", "=", existing.student_id)
                  .where("location_type", "=", existing.location_type),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () =>
                    new HttpError(409, "Set a student rate before completing this lesson"),
                }),
              );
            const deposit = yield* db
              .execute(
                db
                  .selectFrom("app_public.lesson_deposits")
                  .select(["id", "amount_cents"])
                  .where("lesson_id", "=", existing.id)
                  .where("status", "=", "held")
                  .forUpdate(),
              )
              .pipe(Effect.head, Effect.option);
            const heldDeposit = Option.getOrNull(deposit);
            if (heldDeposit) {
              yield* db.execute(
                db
                  .updateTable("app_public.lesson_deposits")
                  .set({ status: "captured" })
                  .where("id", "=", heldDeposit.id),
              );

              const obligation = yield* db
                .execute(
                  db
                    .selectFrom("app_public.bill_line_items as bli")
                    .innerJoin("app_public.bills as b", "b.id", "bli.bill_id")
                    .select(["b.id as bill_id", "b.payer_id", "b.status", "b.total_cents"])
                    .where("bli.lesson_id", "=", existing.id),
                )
                .pipe(Effect.head, Effect.option);
              if (Option.isSome(obligation) && obligation.value.status === "issued") {
                const actor = yield* db
                  .execute(
                    db
                      .selectFrom(
                        db
                          .selectNoFrom(() => sql<string>`app_public.current_user_id()`.as("uid"))
                          .as("t"),
                      )
                      .select(sql<string>`t.uid`.as("user_id")),
                  )
                  .pipe(
                    Effect.head,
                    Effect.map((row) => row.user_id),
                  );
                const credit = yield* db
                  .execute(
                    db
                      .insertInto("app_public.credits")
                      .values({
                        payer_id: obligation.value.payer_id,
                        student_id: existing.student_id,
                        amount_cents: heldDeposit.amount_cents,
                        reason: `Captured deposit for single booking ${existing.id}`,
                        created_by: actor,
                        expires_at: null,
                      })
                      .returning("id"),
                  )
                  .pipe(Effect.head);
                yield* db.execute(
                  db.insertInto("app_public.credit_applications").values({
                    credit_id: credit.id,
                    bill_id: obligation.value.bill_id,
                    amount_cents: heldDeposit.amount_cents,
                  }),
                );
                if (obligation.value.total_cents <= heldDeposit.amount_cents) {
                  yield* db.execute(
                    db
                      .updateTable("app_public.bills")
                      .set({ status: "paid", paid_at: sql`now()` })
                      .where("id", "=", obligation.value.bill_id),
                  );
                }
              }
            }
            const remainderDue =
              rate.billing_model === "single_booking"
                ? Math.max(0, rate.rate_cents - (heldDeposit?.amount_cents ?? 0))
                : 0;
            return yield* db
              .execute(
                db
                  .updateTable("app_public.lessons")
                  .set({
                    status: "completed",
                    completed_at: now,
                    cancellation_fee_cents: 0,
                    remainder_due_cents: remainderDue,
                  })
                  .where("id", "=", existing.id)
                  .returning(lessonColumns),
              )
              .pipe(Effect.head);
          }),
        );
      }),

      listLessons: Effect.fn("listLessons")(function* (
        sessionId: string,
        filters: {
          limit: number;
          offset: number;
          studentId?: string;
          status?: LessonStatus;
          from?: Date;
          to?: Date;
        },
      ) {
        return yield* withAuthContext(sessionId, (db) => {
          let query = db
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
            query = query.where("scheduled_at", "<", filters.to);
          }
          return db.execute(query);
        });
      }),

      saveStudentRate: Effect.fn("saveStudentRate")(function* (values: {
        sessionId: string;
        studentId: string;
        rateCents: number;
        lessonDurationMinutes: number;
        locationType: LocationType;
        billingModel: BillingModel;
        notes: string | null;
      }) {
        return yield* withAuthContext(values.sessionId, (db) =>
          db
            .execute(
              db
                .insertInto("app_public.student_rates")
                .values({
                  student_id: values.studentId,
                  rate_cents: values.rateCents,
                  lesson_duration_minutes: values.lessonDurationMinutes,
                  location_type: values.locationType,
                  billing_model: values.billingModel,
                  notes: values.notes,
                })
                .onConflict((oc) =>
                  oc.columns(["student_id", "location_type"]).doUpdateSet({
                    rate_cents: values.rateCents,
                    lesson_duration_minutes: values.lessonDurationMinutes,
                    billing_model: values.billingModel,
                    notes: values.notes,
                  }),
                )
                .returning([
                  "id",
                  "student_id",
                  "rate_cents",
                  "lesson_duration_minutes",
                  "location_type",
                  "billing_model",
                  "notes",
                  "created_at",
                ]),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(500, "Failed to save student rate"),
              }),
            ),
        );
      }),

      listStudentRates: Effect.fn("listStudentRates")(function* (
        sessionId: string,
        studentId: string,
        locationType?: LocationType,
      ) {
        return yield* withAuthContext(sessionId, (db) => {
          let query = db
            .selectFrom("app_public.student_rates")
            .select([
              "id",
              "student_id",
              "rate_cents",
              "lesson_duration_minutes",
              "location_type",
              "billing_model",
              "notes",
              "created_at",
            ])
            .where("student_id", "=", studentId);
          if (locationType) {
            query = query.where("location_type", "=", locationType);
          }
          return db.execute(query);
        });
      }),

      getCancellationPolicySettings: lessonPolicy.getSettings,

      saveCancellationPolicySettings: lessonPolicy.saveSettings,

      saveLessonNote: Effect.fn("saveLessonNote")(function* (
        sessionId: string,
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
        return yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
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
                .returning(lessonNoteColumns),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(500, "Failed to save lesson note"),
              }),
            ),
        );
      }),

      getLessonNote: Effect.fn("getLessonNote")(function* (sessionId: string, lessonId: string) {
        return yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
                .selectFrom("app_public.lesson_notes")
                .select(lessonNoteColumns)
                .where("lesson_id", "=", lessonId),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(404, "Lesson note not found"),
              }),
            ),
        );
      }),

      publishLessonNote: Effect.fn("publishLessonNote")(function* (
        sessionId: string,
        lessonId: string,
      ) {
        return yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
                .updateTable("app_public.lesson_notes")
                .set({ draft: false })
                .where("lesson_id", "=", lessonId)
                .returning(lessonNoteColumns),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(404, "Lesson note not found"),
              }),
            ),
        );
      }),

      getGoogleCalendarStatus: Effect.fn("getGoogleCalendarStatus")(function* () {
        const rows = yield* rootDb.execute(
          rootDb
            .selectFrom("app_private.admin_settings")
            .select(["key", "value"])
            .where("key", "in", ["gcal_refresh_token", "gcal_calendar_id"]),
        );
        const token = rows.find((r) => r.key === "gcal_refresh_token");
        const calendar = rows.find((r) => r.key === "gcal_calendar_id");
        return {
          connected: !!token,
          calendar_id: calendar?.value ?? null,
        };
      }),

      disconnectGoogleCalendar: Effect.fn("disconnectGoogleCalendar")(function* () {
        yield* rootDb.execute(
          rootDb
            .deleteFrom("app_private.admin_settings")
            .where("key", "in", [
              "gcal_refresh_token",
              "gcal_access_token",
              "gcal_access_token_expires_at",
              "gcal_calendar_id",
              "gcal_sync_token",
            ]),
        );
      }),

      listTestimonials: Effect.fn("listTestimonials")(function* (sessionId: string) {
        return yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
              .selectFrom("app_public.testimonials as t")
              .innerJoin("app_public.users as u", "u.id", "t.user_id")
              .select([
                "t.id",
                "t.user_id",
                "t.body",
                "t.is_approved",
                "t.created_at",
                "t.updated_at",
                "u.username",
                "u.name",
                "u.role",
              ])
              .where("u.role", "!=", "admin")
              .orderBy("t.is_approved", "asc")
              .orderBy("t.updated_at", "desc"),
          ),
        );
      }),

      updateTestimonialApproval: Effect.fn("updateTestimonialApproval")(function* (
        sessionId: string,
        testimonialId: string,
        isApproved: boolean,
      ) {
        return yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
                .with("updated", (qb) =>
                  qb
                    .updateTable("app_public.testimonials")
                    .set({ is_approved: isApproved })
                    .where("id", "=", testimonialId)
                    .returning(["id", "user_id", "is_approved"]),
                )
                .selectFrom("updated")
                .innerJoin("app_public.users as u", "u.id", "updated.user_id")
                .select(["updated.id", "updated.user_id", "updated.is_approved", "u.role"]),
            )
            .pipe(
              Effect.head,
              Effect.option,
              Effect.flatMap(
                Option.match({
                  onNone: () => new HttpError(404, "Testimonial not found"),
                  onSome: Effect.succeed,
                }),
              ),
            ),
        );
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
