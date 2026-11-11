import { Clock, Effect, Option, Context, Layer } from "effect";
import * as S from "effect/Schema";
import * as Struct from "effect/Struct";
import { sql } from "kysely";
import type { LessonStatus } from "../../shared/schemas.js";
import { Module, Material, UserRole } from "../../shared/schemas.js";
import { PgRootDB, withAuthContext, type Database } from "../db.js";
import { catchPgErrors, HttpError } from "../pgErrors.js";
import { GoogleCalendarService } from "./googleCalendarService.js";
import { settleSingleBookingCancellation, singleBookingObligation } from "./singleBookingBills.js";
import { calculateDepositAmount } from "./billingCalculation.js";
import { LessonPolicyService } from "./lessonPolicyService.js";
import { resolveAssignedTrackIndex } from "./notationService.js";
import { SessionService } from "./sessionService.js";

const CourseMaterial = Material.mapFields(
  Struct.assign({
    module_id: S.String,
    sort_order: S.Number,
  }),
);

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
  "recurring_schedule_id",
  "recurrence_date",
  "created_at",
] as const;

function assertAssignedMaterial(db: Database, materialId: string) {
  return db
    .execute(
      db
        .selectFrom("app_public.student_materials")
        .select("material_id")
        .where("material_id", "=", materialId),
    )
    .pipe(
      Effect.head,
      Effect.catchTags({
        NoSuchElementError: () => new HttpError(404, "Assignment not found"),
      }),
    );
}

export class AuthenticatedRouteService extends Context.Service<AuthenticatedRouteService>()(
  "AuthenticatedRouteService",
  {
    make: Effect.sync(() => {
      return {
        courses: Effect.fn("courses")(function* (sessionId: string, studentId?: string) {
          return yield* withAuthContext(sessionId, (db) => {
            let q = db
              .selectFrom("app_public.courses")
              .select(["id", "title", "description", "instrument"]);
            if (studentId) {
              q = q.where((eb) =>
                eb("id", "in", (sq) =>
                  sq
                    .selectFrom("app_public.enrollments")
                    .select("course_id")
                    .where("student_id", "=", studentId),
                ),
              );
            }
            return db.execute(q);
          });
        }),

        courseById: Effect.fn("courseById")(function* (sessionId: string, courseId: string) {
          return yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              const rows = yield* db
                .execute(
                  db
                    .with("course_data", (qb) =>
                      qb
                        .selectFrom("app_public.courses")
                        .select(["id", "title", "description", "instrument"])
                        .where("id", "=", courseId),
                    )
                    .with("mods", (qb) =>
                      qb
                        .selectFrom("app_public.modules")
                        .select(["id", "course_id", "title", "content", "sort_order"])
                        .where("course_id", "=", courseId)
                        .orderBy("sort_order"),
                    )
                    .with("mod_mats", (qb) =>
                      qb
                        .selectFrom("app_public.module_materials as mm")
                        .innerJoin("app_public.materials as mat", "mat.id", "mm.material_id")
                        .innerJoin("app_public.modules as mod", "mod.id", "mm.module_id")
                        .where("mod.course_id", "=", courseId)
                        .select((eb) => [
                          "mm.module_id",
                          "mat.id",
                          "mat.title",
                          "mat.original_filename",
                          "mat.mime_type",
                          eb.cast("mat.file_size", "integer").as("file_size"),
                          "mat.is_global",
                          "mat.notation_tracks",
                          "mm.sort_order",
                        ])
                        .orderBy("mm.sort_order"),
                    )
                    .selectFrom("course_data")
                    .selectAll("course_data")
                    .select((eb) => [
                      eb.fn
                        .coalesce(
                          sql`(SELECT json_agg(row_to_json(mods.*)) FROM mods)`,
                          sql`'[]'::json`,
                        )
                        .as("modules_json"),
                      eb.fn
                        .coalesce(
                          sql`(SELECT json_agg(row_to_json(mod_mats.*)) FROM mod_mats)`,
                          sql`'[]'::json`,
                        )
                        .as("materials_json"),
                    ]),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(404, "Course not found"),
                  }),
                );

              const modulesJson = yield* S.decodeUnknownEffect(S.Array(Module))(rows.modules_json);
              const materialsJson = yield* S.decodeUnknownEffect(S.Array(CourseMaterial))(
                rows.materials_json,
              );

              const matsByModule = new Map<string, S.Schema.Type<typeof CourseMaterial>[]>();
              for (const mat of materialsJson) {
                const list = matsByModule.get(mat.module_id) || [];
                list.push(mat);
                matsByModule.set(mat.module_id, list);
              }

              const {
                modules_json: _modules_json,
                materials_json: _materials_json,
                ...course
              } = rows;
              const modulesWithMaterials = modulesJson.map((mod) => ({
                ...mod,
                materials: matsByModule.get(mod.id) || [],
              }));

              return { ...course, modules: modulesWithMaterials };
            }),
          );
        }),

        library: Effect.fn("library")(function* (
          sessionId: string,
          values: {
            limit: number;
            offset: number;
          },
        ) {
          return yield* withAuthContext(sessionId, (db) =>
            db.execute(
              db
                .selectFrom("app_public.materials")
                .select((eb) => [
                  "id",
                  "title",
                  "original_filename",
                  "mime_type",
                  eb.cast("file_size", "integer").as("file_size"),
                  "is_global",
                  "notation_tracks",
                ])
                .orderBy("created_at", "desc")
                .limit(values.limit)
                .offset(values.offset),
            ),
          );
        }),

        assignments: Effect.fn("assignments")(function* (sessionId: string, studentId?: string) {
          return yield* withAuthContext(sessionId, (db) => {
            let q = db
              .selectFrom("app_public.student_materials as sm")
              .innerJoin("app_public.materials as m", "m.id", "sm.material_id")
              .select((eb) => [
                "m.id",
                "m.title",
                "m.original_filename",
                "m.mime_type",
                eb.cast("m.file_size", "integer").as("file_size"),
                "m.is_global",
                "m.notation_tracks",
                "sm.assigned_track_index",
              ]);
            if (studentId) {
              q = q.where("sm.student_id", "=", studentId);
            }
            return db.execute(q);
          });
        }),

        assignStudentMaterial: Effect.fn("assignStudentMaterial")(function* (values: {
          sessionId: string;
          studentId: string;
          materialId: string;
          assignedTrackIndex?: number | null;
        }) {
          const assignedTrackIndex = yield* resolveAssignedTrackIndex(
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
                  assigned_track_index: assignedTrackIndex,
                })
                .onConflict((oc) =>
                  oc.columns(["student_id", "material_id"]).doUpdateSet({
                    assigned_track_index: assignedTrackIndex,
                  }),
                ),
            ),
          );
        }),

        unassignStudentMaterial: Effect.fn("unassignStudentMaterial")(function* (
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

        practiceLogs: Effect.fn("practiceLogs")(function* (
          sessionId: string,
          materialId?: string,
          studentId?: string,
        ) {
          return yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              let query = db
                .selectFrom("app_public.practice_logs")
                .selectAll()
                .orderBy("logged_at", "desc");
              if (materialId) {
                query = query.where("material_id", "=", materialId);
              }
              if (studentId) {
                query = query.where("student_id", "=", studentId);
              }
              return yield* db.execute(query);
            }),
          );
        }),

        createPracticeLog: Effect.fn("createPracticeLog")(function* (values: {
          sessionId: string;
          studentId: string;
          materialId: string;
          rating?: number;
          durationMinutes?: number;
        }) {
          return yield* withAuthContext(
            values.sessionId,
            Effect.fnUntraced(function* (db) {
              return yield* db
                .execute(
                  db
                    .insertInto("app_public.practice_logs")
                    .values({
                      student_id: values.studentId,
                      material_id: values.materialId,
                      rating: values.rating ?? null,
                      duration_minutes: values.durationMinutes ?? null,
                    })
                    .returning([
                      "id",
                      "student_id",
                      "material_id",
                      "rating",
                      "duration_minutes",
                      "logged_at",
                    ]),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(500, "Failed to create practice log"),
                  }),
                );
            }),
          );
        }),

        ratePracticeLog: Effect.fn("ratePracticeLog")(function* (
          sessionId: string,
          studentId: string,
          materialId: string,
          rating: number,
        ) {
          return yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              const existing = yield* db
                .execute(
                  db
                    .selectFrom("app_public.practice_logs")
                    .selectAll()
                    .where("student_id", "=", studentId)
                    .where("material_id", "=", materialId)
                    .where("rating", "is", null)
                    .orderBy("logged_at", "desc")
                    .limit(1),
                )
                .pipe(Effect.head);

              if (existing) {
                return yield* db
                  .execute(
                    db
                      .updateTable("app_public.practice_logs")
                      .set({ rating })
                      .where("id", "=", existing.id)
                      .returning([
                        "id",
                        "student_id",
                        "material_id",
                        "rating",
                        "duration_minutes",
                        "logged_at",
                      ]),
                  )
                  .pipe(
                    Effect.head,
                    Effect.catchTags({
                      NoSuchElementError: () => new HttpError(500, "Failed to update practice log"),
                    }),
                  );
              }

              return yield* db
                .execute(
                  db
                    .insertInto("app_public.practice_logs")
                    .values({
                      student_id: studentId,
                      material_id: materialId,
                      rating,
                    })
                    .returning([
                      "id",
                      "student_id",
                      "material_id",
                      "rating",
                      "duration_minutes",
                      "logged_at",
                    ]),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(500, "Failed to create practice log"),
                  }),
                );
            }),
          );
        }),

        recordAssignmentPlayback: Effect.fn("recordAssignmentPlayback")(function* (values: {
          sessionId: string;
          studentId: string;
          materialId: string;
          seconds: number;
        }) {
          return yield* withAuthContext(
            values.sessionId,
            Effect.fnUntraced(function* (db) {
              yield* assertAssignedMaterial(db, values.materialId);
              return yield* db
                .execute(
                  db
                    .insertInto("app_public.assignment_progress")
                    .values((eb) => ({
                      student_id: values.studentId,
                      material_id: values.materialId,
                      listened_seconds: values.seconds,
                      last_played_at: eb.fn("now", []),
                      updated_at: eb.fn("now", []),
                    }))
                    .onConflict((oc) =>
                      oc.columns(["student_id", "material_id"]).doUpdateSet((eb) => ({
                        listened_seconds: eb(
                          eb.ref("app_public.assignment_progress.listened_seconds"),
                          "+",
                          values.seconds,
                        ),
                        last_played_at: eb.fn("now", []),
                        updated_at: eb.fn("now", []),
                      })),
                    )
                    .returning(["material_id", "listened_seconds", "updated_at"]),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () =>
                      new HttpError(500, "Failed to record assignment playback"),
                  }),
                );
            }),
          );
        }),

        createAssignmentReview: Effect.fn("createAssignmentReview")(function* (values: {
          sessionId: string;
          studentId: string;
          materialId: string;
          stars: number;
        }) {
          return yield* withAuthContext(
            values.sessionId,
            Effect.fnUntraced(function* (db) {
              const row = yield* db
                .execute(
                  db
                    .selectFrom("app_public.student_materials as sm")
                    .leftJoin(
                      "app_public.assignment_progress as ap",
                      "ap.material_id",
                      "sm.material_id",
                    )
                    .select(["sm.material_id", "ap.listened_seconds"])
                    .where("sm.material_id", "=", values.materialId),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(404, "Assignment not found"),
                  }),
                );

              return yield* db
                .execute(
                  db
                    .insertInto("app_public.assignment_reviews")
                    .values({
                      student_id: values.studentId,
                      material_id: values.materialId,
                      stars: values.stars,
                      listened_seconds: row.listened_seconds ?? 0,
                    })
                    .returning(["id", "material_id", "stars", "listened_seconds", "created_at"]),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () =>
                      new HttpError(500, "Failed to create assignment review"),
                  }),
                );
            }),
          );
        }),

        assignmentNotes: Effect.fn("assignmentNotes")(function* (
          sessionId: string,
          materialId: string,
        ) {
          return yield* withAuthContext(sessionId, (db) =>
            db
              .execute(
                db
                  .selectFrom("app_public.assignment_notes")
                  .selectAll()
                  .where("material_id", "=", materialId),
              )
              .pipe(Effect.head, Effect.option, Effect.map(Option.getOrNull)),
          );
        }),

        upsertAssignmentNotes: Effect.fn("upsertAssignmentNotes")(function* (values: {
          sessionId: string;
          studentId: string;
          materialId: string;
          body: string;
        }) {
          return yield* withAuthContext(
            values.sessionId,
            Effect.fnUntraced(function* (db) {
              return yield* db
                .execute(
                  db
                    .insertInto("app_public.assignment_notes")
                    .values({
                      student_id: values.studentId,
                      material_id: values.materialId,
                      body: values.body,
                    })
                    .onConflict((oc) =>
                      oc.columns(["student_id", "material_id"]).doUpdateSet({
                        body: values.body,
                        updated_at: sql`now()`,
                      }),
                    )
                    .returning([
                      "id",
                      "student_id",
                      "material_id",
                      "body",
                      "created_at",
                      "updated_at",
                    ]),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(500, "Failed to save assignment notes"),
                  }),
                );
            }),
          );
        }),

        messages: Effect.fn("messages")(function* (
          sessionId: string,
          values: {
            limit: number;
            offset: number;
            withUser?: string;
          },
          studentId?: string,
        ) {
          return yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              let query = db
                .selectFrom("app_public.messages")
                .selectAll()
                .orderBy("created_at", "desc")
                .limit(values.limit)
                .offset(values.offset);
              if (values.withUser) {
                query = query.where((eb) =>
                  eb.or([
                    eb("sender_id", "=", values.withUser!),
                    eb("recipient_id", "=", values.withUser!),
                  ]),
                );
              }
              if (studentId) {
                query = query.where((eb) =>
                  eb.or([eb("sender_id", "=", studentId), eb("recipient_id", "=", studentId)]),
                );
              }
              return yield* db.execute(query);
            }),
          );
        }),

        createMessage: Effect.fn("createMessage")(function* (values: {
          sessionId: string;
          senderId: string;
          recipientId?: string;
          body: string;
        }) {
          let recipientId = values.recipientId;
          if (!recipientId) {
            const admin = yield* withAuthContext(values.sessionId, (db) =>
              db
                .execute(
                  db
                    .selectFrom("app_public.users")
                    .select("id")
                    .where((eb) => eb.or([eb("role", "=", "admin"), eb("role", "=", "teacher")]))
                    .limit(1),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(400, "No staff user found"),
                  }),
                ),
            );
            recipientId = admin.id;
          }
          return yield* withAuthContext(values.sessionId, (db) =>
            Effect.head(
              db.execute(
                db
                  .insertInto("app_public.messages")
                  .values({
                    sender_id: values.senderId,
                    recipient_id: recipientId,
                    body: values.body,
                  })
                  .returning(["id", "sender_id", "recipient_id", "body", "is_read", "created_at"]),
              ),
            ).pipe(
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(500, "Failed to send message"),
              }),
            ),
          );
        }),

        markMessageRead: Effect.fn("markMessageRead")(function* (
          sessionId: string,
          messageId: string,
        ) {
          yield* withAuthContext(sessionId, (db) =>
            db.execute(
              db
                .updateTable("app_public.messages")
                .set({ is_read: true })
                .where("id", "=", messageId),
            ),
          );
        }),

        myLessons: Effect.fn("myLessons")(function* (
          sessionId: string,
          values: {
            limit: number;
            offset: number;
            status?: string;
            from?: string;
            to?: string;
          },
          studentId?: string,
        ) {
          return yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              let query = db
                .selectFrom("app_public.lessons")
                .select([
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
                  "created_at",
                ])
                .orderBy("scheduled_at", "desc")
                .limit(values.limit)
                .offset(values.offset);
              if (values.status) {
                query = query.where("status", "=", values.status as LessonStatus);
              }
              if (values.from) {
                query = query.where("scheduled_at", ">=", new Date(values.from));
              }
              if (values.to) {
                query = query.where("scheduled_at", "<", new Date(values.to));
              }
              if (studentId) {
                query = query.where("student_id", "=", studentId);
              }
              return yield* db.execute(query);
            }),
          );
        }),

        myLessonById: Effect.fn("myLessonById")(function* (sessionId: string, lessonId: string) {
          return yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              return yield* db
                .execute(
                  db
                    .selectFrom("app_public.lessons")
                    .select([
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
                      "created_at",
                    ])
                    .where("id", "=", lessonId),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(404, "Lesson not found"),
                  }),
                );
            }),
          );
        }),

        myLessonNotes: Effect.fn("myLessonNotes")(function* (sessionId: string, lessonId: string) {
          return yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              return yield* db
                .execute(
                  db
                    .selectFrom("app_public.lesson_notes")
                    .select([
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
                    ])
                    .where("lesson_id", "=", lessonId),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(404, "Lesson note not found"),
                  }),
                );
            }),
          );
        }),

        myLessonNotesList: Effect.fn("myLessonNotesList")(function* (
          sessionId: string,
          values: {
            limit: number;
            offset: number;
          },
          studentId?: string,
        ) {
          return yield* withAuthContext(sessionId, (db) => {
            let q = db
              .selectFrom("app_public.lesson_notes as ln")
              .innerJoin("app_public.lessons as l", "l.id", "ln.lesson_id")
              .select([
                "ln.id",
                "ln.lesson_id",
                "ln.topics_covered",
                "ln.homework",
                "ln.progress_observations",
                "ln.notes",
                "ln.material_ids",
                "ln.draft",
                "ln.created_at",
                "ln.updated_at",
              ])
              .orderBy("l.scheduled_at", "desc")
              .limit(values.limit)
              .offset(values.offset);
            if (studentId) {
              q = q.where("l.student_id", "=", studentId);
            }
            return db.execute(q);
          });
        }),

        myLessonCancellationPolicy: Effect.fn("myLessonCancellationPolicy")(function* (values: {
          sessionId: string;
          studentId: string;
          lessonId: string;
        }) {
          const row = yield* withAuthContext(values.sessionId, (db) =>
            db
              .execute(
                db
                  .selectFrom("app_public.lessons as l")
                  .innerJoin("app_public.student_rates as sr", (join) =>
                    join
                      .onRef("sr.student_id", "=", "l.student_id")
                      .onRef("sr.location_type", "=", "l.location_type"),
                  )
                  .select(["l.scheduled_at", "l.status", "sr.rate_cents", "sr.billing_model"])
                  .where("l.id", "=", values.lessonId)
                  .where("l.student_id", "=", values.studentId),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () => new HttpError(404, "Lesson not found"),
                }),
              ),
          );
          if (row.status !== "scheduled") {
            return yield* new HttpError(409, "Only scheduled lessons can be cancelled");
          }
          const now = new Date(yield* Clock.currentTimeMillis);
          if (new Date(row.scheduled_at).getTime() <= now.getTime()) {
            return yield* new HttpError(409, "Only future lessons can be cancelled");
          }
          const deposit = yield* withAuthContext(values.sessionId, (db) =>
            db
              .execute(
                db
                  .selectFrom("app_public.lesson_deposits")
                  .select("amount_cents")
                  .where("lesson_id", "=", values.lessonId)
                  .where("status", "=", "held"),
              )
              .pipe(Effect.head, Effect.option),
          );
          return yield* LessonPolicyService.use((lessonPolicyService) =>
            lessonPolicyService.evaluate({
              billingModel: row.billing_model,
              scheduledAt: new Date(row.scheduled_at),
              rateCents: row.rate_cents,
              heldDepositCents: Option.getOrNull(deposit)?.amount_cents ?? null,
              now,
            }),
          );
        }),

        cancelMyLesson: Effect.fn("cancelMyLesson")(function* (values: {
          sessionId: string;
          studentId: string;
          lessonId: string;
          reason: string | null;
        }) {
          const settings = yield* LessonPolicyService.use((lessonPolicyService) =>
            lessonPolicyService.getSettings(),
          );
          const now = new Date(yield* Clock.currentTimeMillis);
          const result = yield* withAuthContext(
            values.sessionId,
            Effect.fnUntraced(function* (db) {
              const row = yield* db
                .execute(
                  db
                    .selectFrom("app_public.lessons as l")
                    .innerJoin("app_public.student_rates as sr", (join) =>
                      join
                        .onRef("sr.student_id", "=", "l.student_id")
                        .onRef("sr.location_type", "=", "l.location_type"),
                    )
                    .select([
                      "l.id",
                      "l.scheduled_at",
                      "l.status",
                      "l.gcal_event_id",
                      "sr.rate_cents",
                      "sr.billing_model",
                    ])
                    .where("l.id", "=", values.lessonId)
                    .where("l.student_id", "=", values.studentId)
                    .forUpdate(),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(404, "Lesson not found"),
                  }),
                );
              if (row.status !== "scheduled") {
                return yield* new HttpError(409, "Only scheduled lessons can be cancelled");
              }
              if (new Date(row.scheduled_at).getTime() <= now.getTime()) {
                return yield* new HttpError(409, "Only future lessons can be cancelled");
              }
              const deposit = yield* db
                .execute(
                  db
                    .selectFrom("app_public.lesson_deposits")
                    .select(["id", "amount_cents"])
                    .where("lesson_id", "=", row.id)
                    .where("status", "=", "held")
                    .forUpdate(),
                )
                .pipe(Effect.head, Effect.option);
              const heldDeposit = Option.getOrNull(deposit);
              const policy = yield* LessonPolicyService.use((lessonPolicyService) =>
                lessonPolicyService.evaluate({
                  billingModel: row.billing_model,
                  scheduledAt: new Date(row.scheduled_at),
                  rateCents: row.rate_cents,
                  heldDepositCents: heldDeposit?.amount_cents ?? null,
                  settings,
                  now,
                }),
              );
              if (heldDeposit && policy.deposit_outcome !== "none") {
                yield* db.execute(
                  db
                    .updateTable("app_public.lesson_deposits")
                    .set({ status: policy.deposit_outcome })
                    .where("id", "=", heldDeposit.id),
                );
                if (row.billing_model === "single_booking") {
                  yield* db.execute(
                    settleSingleBookingCancellation(
                      db,
                      row.id,
                      policy.deposit_outcome === "captured" ? heldDeposit.amount_cents : 0,
                    ),
                  );
                }
              }
              const lesson = yield* db
                .execute(
                  db
                    .updateTable("app_public.lessons")
                    .set({
                      status: "cancelled",
                      cancellation_reason: values.reason ?? "student",
                      cancelled_at: now,
                      cancellation_fee_cents:
                        policy.fee_outcome === "recorded" ? policy.amount_cents : 0,
                      remainder_due_cents: 0,
                    })
                    .where("id", "=", row.id)
                    .returning(lessonColumns),
                )
                .pipe(Effect.head);
              return { lesson, gcalEventId: row.gcal_event_id };
            }),
          );
          if (result.gcalEventId) {
            const googleCalendarService = yield* GoogleCalendarService;
            yield* googleCalendarService.deleteEvent(result.gcalEventId).pipe(Effect.ignore);
          }
          return result.lesson;
        }),

        rescheduleMyLesson: Effect.fn("rescheduleMyLesson")(function* (values: {
          sessionId: string;
          studentId: string;
          lessonId: string;
          scheduledAt: Date;
        }) {
          const now = new Date(yield* Clock.currentTimeMillis);
          if (!Number.isFinite(values.scheduledAt.getTime()) || values.scheduledAt <= now) {
            return yield* new HttpError(400, "The new lesson time must be in the future");
          }
          const existing = yield* withAuthContext(values.sessionId, (db) =>
            db
              .execute(
                db
                  .selectFrom("app_public.lessons")
                  .select(["scheduled_at", "duration_minutes", "gcal_event_id", "status"])
                  .where("id", "=", values.lessonId)
                  .where("student_id", "=", values.studentId),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () => new HttpError(404, "Lesson not found"),
                }),
              ),
          );
          if (existing.status !== "scheduled" || new Date(existing.scheduled_at) <= now) {
            return yield* new HttpError(409, "Only future scheduled lessons can be rescheduled");
          }
          if (
            yield* LessonPolicyService.use((lessonPolicyService) =>
              lessonPolicyService.hasScheduledOverlap({
                lessonId: values.lessonId,
                scheduledAt: values.scheduledAt,
                durationMinutes: existing.duration_minutes,
              }),
            )
          ) {
            return yield* new HttpError(409, "The new lesson time overlaps another lesson");
          }

          const oldStart = new Date(existing.scheduled_at);
          const oldEnd = new Date(oldStart.getTime() + existing.duration_minutes * 60 * 1000);
          const newEnd = new Date(
            values.scheduledAt.getTime() + existing.duration_minutes * 60 * 1000,
          );
          if (existing.gcal_event_id) {
            const googleCalendarService = yield* GoogleCalendarService;
            yield* googleCalendarService.updateEvent(existing.gcal_event_id, {
              start: values.scheduledAt.toISOString(),
              end: newEnd.toISOString(),
            });
          }

          const settings = yield* LessonPolicyService.use((lessonPolicyService) =>
            lessonPolicyService.getSettings(),
          );
          const persist = withAuthContext(
            values.sessionId,
            Effect.fnUntraced(function* (db) {
              const row = yield* db
                .execute(
                  db
                    .selectFrom("app_public.lessons as l")
                    .innerJoin("app_public.student_rates as sr", (join) =>
                      join
                        .onRef("sr.student_id", "=", "l.student_id")
                        .onRef("sr.location_type", "=", "l.location_type"),
                    )
                    .select([
                      "l.id",
                      "l.scheduled_at",
                      "l.status",
                      "sr.rate_cents",
                      "sr.billing_model",
                    ])
                    .where("l.id", "=", values.lessonId)
                    .where("l.student_id", "=", values.studentId)
                    .forUpdate(),
                )
                .pipe(Effect.head);
              if (
                row.status !== "scheduled" ||
                new Date(row.scheduled_at).getTime() !== oldStart.getTime()
              ) {
                return yield* new HttpError(409, "Lesson changed while it was being rescheduled");
              }
              if (row.billing_model === "single_booking") {
                const deposit = yield* db
                  .execute(
                    db
                      .selectFrom("app_public.lesson_deposits")
                      .select(["id", "amount_cents"])
                      .where("lesson_id", "=", row.id)
                      .where("status", "=", "held")
                      .forUpdate(),
                  )
                  .pipe(Effect.head, Effect.option);
                const heldDeposit = Option.getOrNull(deposit);
                const policy = yield* LessonPolicyService.use((lessonPolicyService) =>
                  lessonPolicyService.evaluate({
                    billingModel: row.billing_model,
                    scheduledAt: oldStart,
                    rateCents: row.rate_cents,
                    heldDepositCents: heldDeposit?.amount_cents ?? null,
                    settings,
                    now,
                  }),
                );
                if (heldDeposit && policy.deposit_outcome !== "none") {
                  yield* db.execute(
                    db
                      .updateTable("app_public.lesson_deposits")
                      .set({ status: policy.deposit_outcome })
                      .where("id", "=", heldDeposit.id),
                  );
                }
                yield* db.execute(
                  db.insertInto("app_public.lesson_deposits").values({
                    lesson_id: row.id,
                    amount_cents: calculateDepositAmount(row.rate_cents),
                    status: "held",
                  }),
                );
              }
              return yield* db
                .execute(
                  db
                    .updateTable("app_public.lessons")
                    .set({
                      scheduled_at: values.scheduledAt,
                      cancellation_fee_cents: 0,
                      remainder_due_cents: 0,
                    })
                    .where("id", "=", row.id)
                    .returning(lessonColumns),
                )
                .pipe(Effect.head);
            }),
          );

          return yield* persist.pipe(
            Effect.catch((error) => {
              const gcalEventId = existing.gcal_event_id;
              return gcalEventId
                ? GoogleCalendarService.use((googleCalendarService) =>
                    googleCalendarService.updateEvent(gcalEventId, {
                      start: oldStart.toISOString(),
                      end: oldEnd.toISOString(),
                    }),
                  ).pipe(Effect.ignore, Effect.andThen(Effect.fail(error)))
                : Effect.fail(error);
            }),
          );
        }),

        bookLesson: Effect.fn("bookLesson")(function* (values: {
          sessionId: string;
          userId: string;
          scheduledAt: Date;
          durationMinutes: number;
          locationType:
            "in_person_teacher_travels" | "in_person_student_travels" | "studio" | "online";
        }) {
          const slotEnd = new Date(values.scheduledAt.getTime() + values.durationMinutes * 60000);

          const { lesson } = yield* withAuthContext(
            values.sessionId,
            Effect.fnUntraced(function* (db) {
              const preflight = yield* db
                .execute(
                  db
                    .with("ol", (qb) =>
                      qb
                        .selectFrom("app_public.lessons")
                        .select((eb) => eb.fn.countAll<number>().as("overlap_count"))
                        .where("status", "=", "scheduled")
                        .where("scheduled_at", "<", slotEnd)
                        .where(
                          sql`scheduled_at + (duration_minutes || ' minutes')::interval`,
                          ">",
                          values.scheduledAt,
                        ),
                    )
                    .with("rate", (qb) =>
                      qb
                        .selectFrom("app_public.student_rates")
                        .select(["rate_cents", "lesson_duration_minutes", "billing_model"])
                        .where("student_id", "=", values.userId)
                        .where("location_type", "=", values.locationType),
                    )
                    .selectFrom("ol")
                    .select((eb) => [
                      "ol.overlap_count",
                      eb.selectFrom("rate").select("rate_cents").as("rate_cents"),
                      eb
                        .selectFrom("rate")
                        .select("lesson_duration_minutes")
                        .as("lesson_duration_minutes"),
                      eb.selectFrom("rate").select("billing_model").as("billing_model"),
                    ]),
                )
                .pipe(Effect.head);

              if (preflight.overlap_count > 0) {
                return yield* new HttpError(400, "This time slot is no longer available");
              }

              if (
                preflight.rate_cents == null ||
                preflight.lesson_duration_minutes == null ||
                preflight.billing_model == null
              ) {
                return yield* new HttpError(
                  404,
                  "No rate configured for this location type. Please contact your teacher.",
                );
              }

              const rate = {
                rate_cents: preflight.rate_cents,
                lesson_duration_minutes: preflight.lesson_duration_minutes,
                billing_model: preflight.billing_model,
              };

              const lesson = yield* db
                .execute(
                  db
                    .insertInto("app_public.lessons")
                    .values({
                      student_id: values.userId,
                      scheduled_at: values.scheduledAt,
                      duration_minutes: values.durationMinutes,
                      location_type: values.locationType,
                      status: "scheduled",
                    })
                    .returning([
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
                      "created_at",
                    ]),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(500, "Failed to create lesson"),
                  }),
                );

              if (rate.billing_model === "single_booking") {
                yield* db.execute(
                  db.insertInto("app_public.lesson_deposits").values({
                    lesson_id: lesson.id,
                    amount_cents: calculateDepositAmount(rate.rate_cents),
                    status: "held",
                  }),
                );
                yield* db.execute(singleBookingObligation(db, lesson.id));
              }

              return { lesson, rate };
            }),
          );

          const connected = yield* GoogleCalendarService.use((googleCalendarService) =>
            googleCalendarService.isConnected(),
          );
          if (connected) {
            const student = yield* withAuthContext(values.sessionId, (db) =>
              db
                .execute(
                  db
                    .selectFrom("app_public.users")
                    .select(["name", "username"])
                    .where("id", "=", values.userId),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(404, "Student not found"),
                  }),
                ),
            );
            const studentName = student.name || student.username || "Student";
            const eventId = yield* GoogleCalendarService.use((googleCalendarService) =>
              googleCalendarService.createEvent({
                summary: `Lesson: ${studentName}`,
                description: `${values.durationMinutes} min ${values.locationType.replace(/_/g, " ")} lesson`,
                start: values.scheduledAt.toISOString(),
                end: slotEnd.toISOString(),
              }),
            );
            if (eventId) {
              yield* withAuthContext(values.sessionId, (db) =>
                db.execute(
                  db
                    .updateTable("app_public.lessons")
                    .set({ gcal_event_id: eventId })
                    .where("id", "=", lesson.id),
                ),
              );
            }
          }

          return lesson;
        }),

        createChild: Effect.fnUntraced(function* (sessionId: string, userId: string, name: string) {
          const memberships = yield* withAuthContext(sessionId, (db) =>
            db.execute(
              db
                .selectFrom("app_public.family_memberships")
                .select("family_id")
                .where("user_id", "=", userId)
                .limit(2),
            ),
          );

          if (memberships.length === 0) {
            return yield* new HttpError(400, "You must belong to a family to add a student");
          }

          if (memberships.length > 1) {
            return yield* new HttpError(
              400,
              "You belong to multiple families. Please contact an admin to choose which family this student should join.",
            );
          }

          const familyId = memberships[0]!.family_id;

          type ChildRow = {
            id: string;
            username: string;
            name: string | null;
            role: string;
            is_verified: boolean;
          };

          const child = yield* withAuthContext(sessionId, (db) =>
            db
              .execute(
                db
                  .selectFrom(
                    sql<ChildRow>`app_public.create_child(${familyId}, ${name})`.as("child"),
                  )
                  .selectAll(),
              )
              .pipe(Effect.head),
          );

          yield* SessionService.use((sessionService) =>
            sessionService.updateActiveStudent(sessionId, child.id),
          );

          return {
            id: child.id,
            username: child.username,
            name: child.name ?? "",
            role: S.decodeUnknownSync(UserRole)(child.role),
            is_verified: child.is_verified,
          };
        }),

        family: Effect.fn("family")(function* (sessionId: string, userId: string) {
          const rootDb = yield* PgRootDB;

          const result = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              const membership = yield* db
                .execute(
                  db
                    .selectFrom("app_public.family_memberships as fm")
                    .innerJoin("app_public.families as f", "f.id", "fm.family_id")
                    .select([
                      "f.id",
                      "f.slug",
                      "f.name",
                      "f.description",
                      "fm.is_owner",
                      "fm.is_billing_contact",
                    ])
                    .where("fm.user_id", "=", userId),
                )
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(404, "Family not found"),
                  }),
                );

              const members = yield* db.execute(
                db
                  .selectFrom("app_public.family_memberships as fm")
                  .innerJoin("app_public.users as u", "u.id", "fm.user_id")
                  .select([
                    "u.id",
                    "u.username",
                    "u.name",
                    "u.role",
                    "u.is_verified",
                    "fm.is_owner",
                    "fm.is_billing_contact",
                  ])
                  .where("fm.family_id", "=", membership.id),
              );

              return { membership, members };
            }),
          );

          const invitations = yield* rootDb.execute(
            rootDb
              .selectFrom("app_public.family_invitations")
              .select(["id", "email", "invited_role", "code", "expires_at"])
              .where("family_id", "=", result.membership.id),
          );

          return {
            id: result.membership.id,
            slug: result.membership.slug,
            name: result.membership.name,
            description: result.membership.description ?? null,
            members: result.members.map((m) => ({
              id: m.id,
              username: m.username,
              name: m.name ?? null,
              role: m.role,
              is_verified: m.is_verified,
              is_owner: m.is_owner,
              is_billing_contact: m.is_billing_contact,
            })),
            pendingInvitations: invitations.map((i) => ({
              id: i.id,
              email: i.email ?? null,
              invited_role: i.invited_role as string,
              code: i.code ?? null,
              expires_at: i.expires_at,
            })),
          };
        }),

        removeFamilyMember: Effect.fn("removeFamilyMember")(function* (
          sessionId: string,
          userId: string,
          targetUserId: string,
        ) {
          const membership = yield* withAuthContext(sessionId, (db) =>
            db
              .execute(
                db
                  .selectFrom("app_public.family_memberships as fm")
                  .select("fm.family_id")
                  .where("fm.user_id", "=", userId)
                  .where("fm.is_owner", "=", true),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () =>
                    new HttpError(403, "Only the family owner can remove members"),
                }),
              ),
          );

          yield* withAuthContext(sessionId, (db) =>
            db.execute(
              db.selectNoFrom((eb) =>
                eb
                  .fn<unknown>("app_public.remove_from_family", [
                    eb.val(membership.family_id),
                    eb.val(targetUserId),
                  ])
                  .as("remove_from_family"),
              ),
            ),
          ).pipe(catchPgErrors);
        }),

        inviteFamilyMember: Effect.fn("inviteFamilyMember")(function* (
          sessionId: string,
          userId: string,
          email: string,
        ) {
          const membership = yield* withAuthContext(sessionId, (db) =>
            db
              .execute(
                db
                  .selectFrom("app_public.family_memberships as fm")
                  .select("fm.family_id")
                  .where("fm.user_id", "=", userId)
                  .where("fm.is_owner", "=", true),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () =>
                    new HttpError(403, "Only the family owner can invite members"),
                }),
              ),
          );

          yield* withAuthContext(sessionId, (db) =>
            db.execute(
              db.selectNoFrom((eb) =>
                eb
                  .fn<unknown>("app_public.invite_to_family", [
                    eb.val(membership.family_id),
                    eb.val(null),
                    eb.val(email),
                    eb.val("parent"),
                  ])
                  .as("invite_to_family"),
              ),
            ),
          ).pipe(catchPgErrors);
        }),

        setChildEmail: Effect.fn("setChildEmail")(function* (
          sessionId: string,
          parentId: string,
          childId: string,
          email: string,
        ) {
          const rootDb = yield* PgRootDB;

          yield* rootDb
            .execute(
              rootDb.selectNoFrom((eb) =>
                eb
                  .fn<void>("app_private.set_child_email", [
                    eb.val(parentId),
                    eb.val(childId),
                    eb.val(email),
                  ])
                  .as("set_child_email"),
              ),
            )
            .pipe(catchPgErrors);

          return { success: true as const };
        }),

        requestChildPasswordSet: Effect.fn("requestChildPasswordSet")(function* (
          sessionId: string,
          parentId: string,
          childId: string,
        ) {
          const rootDb = yield* PgRootDB;

          const rows = yield* rootDb
            .execute(
              rootDb.selectNoFrom((eb) =>
                eb
                  .fn<string>("app_private.request_child_password_set", [
                    eb.val(parentId),
                    eb.val(childId),
                  ])
                  .as("token"),
              ),
            )
            .pipe(catchPgErrors);

          return { token: rows[0]?.token ?? "" };
        }),

        setChildPassword: Effect.fn("setChildPassword")(function* (
          sessionId: string,
          childId: string,
          token: string,
          password: string,
        ) {
          const rootDb = yield* PgRootDB;

          yield* rootDb
            .execute(
              rootDb.selectNoFrom((eb) =>
                eb
                  .fn<void>("app_private.set_child_password", [
                    eb.val(childId),
                    eb.val(token),
                    eb.val(password),
                  ])
                  .as("set_child_password"),
              ),
            )
            .pipe(catchPgErrors);

          return { success: true as const };
        }),
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
