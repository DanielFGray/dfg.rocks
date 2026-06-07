import { Effect, Option } from "effect";
import * as S from "effect/Schema";
import { sql } from "kysely";
import type { LessonStatus } from "../../shared/schemas.js";
import { Module, Material } from "../../shared/schemas.js";
import { PgAuthDB, PgRootDB, withAuthContext, type AuthKyselyDB } from "../db.js";
import { catchPgErrors, HttpError } from "../pgErrors.js";
import { GoogleCalendarService } from "./googleCalendarService.js";
import { NotationService } from "./notationService.js";
import { TestimonialReminderService } from "./testimonialReminderService.js";

const CourseMaterial = S.extend(
  Material,
  S.Struct({
    module_id: S.String,
    sort_order: S.Number,
  }),
);

function assertAssignedMaterial(db: AuthKyselyDB, materialId: string) {
  return Effect.flatMap(
    db
      .selectFrom("app_public.student_materials")
      .select("material_id")
      .where("material_id", "=", materialId)
      .pipe(Effect.head),
    (assignment) => (assignment ? Effect.void : HttpError.make(404, "Assignment not found")),
  );
}

function testimonialSelect(db: AuthKyselyDB, userId: string) {
  return db
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
    .where("t.user_id", "=", userId)
    .limit(1);
}

export class AuthenticatedRouteService extends Effect.Service<AuthenticatedRouteService>()(
  "AuthenticatedRouteService",
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const rootDb = yield* PgRootDB;
      const authDb = yield* PgAuthDB;
      return {
        courses: Effect.fn("courses")(function* (sessionId: string) {
          return yield* withAuthContext(sessionId, (db) =>
            db
              .selectFrom("app_public.courses")
              .select(["id", "title", "description", "instrument"]),
          );
        }),

        courseById: Effect.fn("courseById")(function* (sessionId: string, courseId: string) {
          return yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              const rows = yield* db
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
                    .select([
                      "mm.module_id",
                      "mat.id",
                      "mat.title",
                      "mat.original_filename",
                      "mat.mime_type",
                      "mat.file_size",
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
                ])
                .pipe(
                  Effect.head,
                  Effect.orElseFail(() => new HttpError(404, "Course not found")),
                );

              const modulesJson = yield* S.decodeUnknown(S.Array(Module))(
                rows.modules_json,
              );
              const materialsJson = yield* S.decodeUnknown(S.Array(CourseMaterial))(
                rows.materials_json,
              );

              const matsByModule = new Map<string, S.Schema.Type<typeof CourseMaterial>[]>();
              for (const mat of materialsJson) {
                const list = matsByModule.get(mat.module_id) || [];
                list.push(mat);
                matsByModule.set(mat.module_id, list);
              }

              const { modules_json: _modules_json, materials_json: _materials_json, ...course } = rows;
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
            db
              .selectFrom("app_public.materials")
              .select([
                "id",
                "title",
                "original_filename",
                "mime_type",
                "file_size",
                "is_global",
                "notation_tracks",
              ])
              .orderBy("created_at", "desc")
              .limit(values.limit)
              .offset(values.offset),
          );
        }),

        assignments: Effect.fn("assignments")(function* (sessionId: string) {
          return yield* withAuthContext(sessionId, (db) =>
            db
              .selectFrom("app_public.student_materials as sm")
              .innerJoin("app_public.materials as m", "m.id", "sm.material_id")
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
          );
        }),

        assignStudentMaterial: Effect.fn("assignStudentMaterial")(function* (values: {
          studentId: string;
          materialId: string;
          assignedTrackIndex?: number | null;
        }) {
          const assignedTrackIndex = yield* NotationService.resolveAssignedTrackIndex(
            values.materialId,
            values.assignedTrackIndex,
          );
          yield* rootDb
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
            );
        }),

        unassignStudentMaterial: Effect.fn("unassignStudentMaterial")(function* (
          studentId: string,
          materialId: string,
        ) {
          yield* rootDb
            .deleteFrom("app_public.student_materials")
            .where("student_id", "=", studentId)
            .where("material_id", "=", materialId);
        }),

        practiceLogs: Effect.fn("practiceLogs")(function* (sessionId: string, materialId?: string) {
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
              return yield* query;
            }),
          );
        }),

        createPracticeLog: Effect.fn("createPracticeLog")(function* (values: {
          sessionId: string;
          studentId: string;
          materialId: string;
          status: "practiced" | "completed";
          notes?: string;
        }) {
          return yield* withAuthContext(
            values.sessionId,
            Effect.fnUntraced(function* (db) {
              return yield* db
                .insertInto("app_public.practice_logs")
                .values({
                  student_id: values.studentId,
                  material_id: values.materialId,
                  status: values.status,
                  notes: values.notes ?? null,
                })
                .returning(["id", "student_id", "material_id", "status", "notes", "logged_at"])
                .pipe(
                  Effect.head,
                  Effect.orElseFail(() => new HttpError(500, "Failed to create practice log")),
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
                .returning(["material_id", "listened_seconds", "updated_at"])
                .pipe(
                  Effect.head,
                  Effect.orElseFail(
                    () => new HttpError(500, "Failed to record assignment playback"),
                  ),
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
                .selectFrom("app_public.student_materials as sm")
                .leftJoin(
                  "app_public.assignment_progress as ap",
                  "ap.material_id",
                  "sm.material_id",
                )
                .select(["sm.material_id", "ap.listened_seconds"])
                .where("sm.material_id", "=", values.materialId)
                .pipe(Effect.head);

              if (!row?.material_id) {
                return yield* new HttpError(404, "Assignment not found");
              }

              return yield* db
                .insertInto("app_public.assignment_reviews")
                .values({
                  student_id: values.studentId,
                  material_id: values.materialId,
                  stars: values.stars,
                  listened_seconds: row.listened_seconds ?? 0,
                })
                .returning(["id", "material_id", "stars", "listened_seconds", "created_at"])
                .pipe(
                  Effect.head,
                  Effect.orElseFail(() => new HttpError(500, "Failed to create assignment review")),
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
              .selectFrom("app_public.assignment_notes")
              .selectAll()
              .where("material_id", "=", materialId)
              .pipe(Effect.head),
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
                .insertInto("app_public.assignment_notes")
                .values({
                  student_id: values.studentId,
                  material_id: values.materialId,
                  body: values.body,
                })
                .onConflict((oc) =>
                  oc.columns(["student_id", "material_id"]).doUpdateSet({
                    body: values.body,
                    updated_at: new Date(),
                  }),
                )
                .returning(["id", "student_id", "material_id", "body", "created_at", "updated_at"])
                .pipe(
                  Effect.head,
                  Effect.orElseFail(() => new HttpError(500, "Failed to save assignment notes")),
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
              return yield* query;
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
            const admin = yield* rootDb
              .selectFrom("app_public.users")
              .select("id")
              .where((eb) => eb.or([eb("role", "=", "admin"), eb("role", "=", "teacher")]))
              .limit(1)
              .pipe(
                Effect.head,
                Effect.orElseFail(() => new HttpError(400, "No staff user found")),
              );
            recipientId = admin.id;
          }
          return yield* withAuthContext(values.sessionId, (db) =>
            Effect.head(
              db
                .insertInto("app_public.messages")
                .values({
                  sender_id: values.senderId,
                  recipient_id: recipientId,
                  body: values.body,
                })
                .returning(["id", "sender_id", "recipient_id", "body", "is_read", "created_at"]),
            ).pipe(Effect.orElseFail(() => HttpError.make(500, "Failed to send message"))),
          );
        }),

        markMessageRead: Effect.fn("markMessageRead")(function* (
          sessionId: string,
          messageId: string,
        ) {
          yield* withAuthContext(sessionId, (db) =>
            db
              .updateTable("app_public.messages")
              .set({ is_read: true })
              .where("id", "=", messageId),
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
                query = query.where("scheduled_at", "<=", new Date(values.to));
              }
              return yield* query;
            }),
          );
        }),

        myLessonById: Effect.fn("myLessonById")(function* (sessionId: string, lessonId: string) {
          return yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              return yield* db
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
                  "created_at",
                ])
                .where("id", "=", lessonId)
                .pipe(
                  Effect.head,
                  Effect.orElseFail(() => new HttpError(404, "Lesson not found")),
                );
            }),
          );
        }),

        requestDeleteAccount: Effect.fn("requestDeleteAccount")(function* (sessionId: string) {
          yield* withAuthContext(sessionId, (db) =>
            db.selectNoFrom((eb) =>
              eb
                .fn<unknown>("app_public.request_account_deletion", [])
                .as("request_account_deletion"),
            ),
          );
        }),

        confirmDeleteAccount: Effect.fn("confirmDeleteAccount")(function* (
          sessionId: string,
          token: string,
        ) {
          const result = yield* withAuthContext(sessionId, (db) =>
            db
              .selectNoFrom((eb) =>
                eb
                  .fn<boolean>("app_public.confirm_account_deletion", [eb.val(token)])
                  .as("confirm_account_deletion"),
              )
              .pipe(Effect.head),
          );
          return result?.confirm_account_deletion ?? false;
        }),

        myLessonNotes: Effect.fn("myLessonNotes")(function* (sessionId: string, lessonId: string) {
          return yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              return yield* db
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
                .where("lesson_id", "=", lessonId)
                .pipe(
                  Effect.head,
                  Effect.orElseFail(() => new HttpError(404, "Lesson note not found")),
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
        ) {
          return yield* withAuthContext(sessionId, (db) =>
            db
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
              .offset(values.offset),
          );
        }),

        myEmails: Effect.fn("myEmails")(function* (sessionId: string) {
          return yield* withAuthContext(sessionId, (db) =>
            db
              .selectFrom("app_public.user_emails")
              .select(["id", "email", "is_verified", "is_primary", "created_at"])
              .orderBy("is_primary", "desc")
              .orderBy("created_at", "asc"),
          );
        }),

        addMyEmail: Effect.fn("addMyEmail")(function* (sessionId: string, email: string) {
          return yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              return yield* db
                .insertInto("app_public.user_emails")
                .values({ email })
                .returning(["id", "email", "is_verified", "is_primary", "created_at"])
                .pipe(
                  Effect.head,
                  Effect.orElseFail(() => new HttpError(500, "Failed to add email")),
                );
            }),
          ).pipe(catchPgErrors);
        }),

        deleteMyEmail: Effect.fn("deleteMyEmail")(function* (sessionId: string, emailId: string) {
          yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              const email = yield* db
                .selectFrom("app_public.user_emails")
                .select(["id", "is_primary"])
                .where("id", "=", emailId)
                .pipe(
                  Effect.head,
                  Effect.orElseFail(() => new HttpError(404, "Email not found")),
                );
              if (email.is_primary) {
                return yield* new HttpError(400, "Cannot delete primary email");
              }
              yield* db.deleteFrom("app_public.user_emails").where("id", "=", emailId);
            }),
          );
        }),

        makePrimaryEmail: Effect.fn("makePrimaryEmail")(function* (
          sessionId: string,
          emailId: string,
        ) {
          return yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              yield* db
                .selectFrom("app_public.user_emails")
                .select(["id"])
                .where("id", "=", emailId)
                .pipe(
                  Effect.head,
                  Effect.catchTag(
                    "NoSuchElementException",
                    () => new HttpError(404, "Email not found"),
                  ),
                );
              yield* db.selectNoFrom((eb) =>
                eb
                  .fn<unknown>("app_public.make_email_primary", [eb.val(emailId)])
                  .as("make_email_primary"),
              );
              const updated = yield* db
                .selectFrom("app_public.user_emails")
                .select(["id", "email", "is_verified", "is_primary", "created_at"])
                .where("id", "=", emailId)
                .pipe(
                  Effect.head,
                  Effect.catchTag(
                    "NoSuchElementException",
                    () => new HttpError(404, "Email not found"),
                  ),
                );
              return updated;
            }),
          );
        }),

        resendEmailVerification: Effect.fn("resendEmailVerification")(function* (
          sessionId: string,
          emailId: string,
        ) {
          yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              const email = yield* db
                .selectFrom("app_public.user_emails")
                .select(["id", "is_verified"])
                .where("id", "=", emailId)
                .pipe(
                  Effect.head,
                  Effect.catchTag(
                    "NoSuchElementException",
                    () => new HttpError(404, "Email not found"),
                  ),
                );
              if (email.is_verified) {
                return yield* new HttpError(400, "Email is already verified");
              }
              yield* db.selectNoFrom((eb) =>
                eb
                  .fn<unknown>("app_public.resend_email_verification_code", [eb.val(emailId)])
                  .as("resend_email_verification_code"),
              );
            }),
          );
        }),

        testimonial: Effect.fn("testimonial")(function* (sessionId: string, userId: string) {
          return yield* withAuthContext(sessionId, (db) =>
            testimonialSelect(db, userId).pipe(
              Effect.head,
              Effect.option,
              Effect.map(Option.getOrNull),
            ),
          );
        }),

        upsertTestimonial: Effect.fn("upsertTestimonial")(function* (
          sessionId: string,
          userId: string,
          body: string,
        ) {
          const row = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              yield* db
                .insertInto("app_public.testimonials")
                .values({ body })
                .onConflict((oc) =>
                  oc.column("user_id").doUpdateSet({
                    body,
                  }),
                );
              return yield* testimonialSelect(db, userId).pipe(
                Effect.head,
                Effect.orElseFail(() => HttpError.make(500, "Failed to save testimonial")),
              );
            }),
          );
          yield* TestimonialReminderService.clearReminderState(userId);
          return row;
        }),

        deleteTestimonial: Effect.fn("deleteTestimonial")(function* (
          sessionId: string,
          userId: string,
        ) {
          const deleted = yield* withAuthContext(
            sessionId,
            Effect.fnUntraced(function* (db) {
              return yield* db
                .deleteFrom("app_public.testimonials")
                .where("user_id", "=", userId)
                .returning(["id"])
                .pipe(Effect.head);
            }),
          );
          if (!deleted) {
            return yield* HttpError.make(404, "Testimonial not found");
          }
          yield* TestimonialReminderService.scheduleNextReminder(userId);
        }),

        bookLesson: Effect.fn("bookLesson")(function* (values: {
          userId: string;
          userName?: string | null;
          scheduledAt: Date;
          durationMinutes: number;
          locationType:
            | "in_person_teacher_travels"
            | "in_person_student_travels"
            | "studio"
            | "online";
        }) {
          const slotEnd = new Date(values.scheduledAt.getTime() + values.durationMinutes * 60000);

          const [preflight] = yield* authDb
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
                .select(["rate_cents", "lesson_duration_minutes"])
                .where("student_id", "=", values.userId)
                .where("location_type", "=", values.locationType),
            )
            .selectFrom("ol")
            .select((eb) => [
              "ol.overlap_count",
              eb.selectFrom("rate").select("rate_cents").as("rate_cents"),
              eb.selectFrom("rate").select("lesson_duration_minutes").as("lesson_duration_minutes"),
            ]);

          if (preflight.overlap_count > 0) {
            return yield* new HttpError(400, "This time slot is no longer available");
          }

          if (preflight.rate_cents == null || preflight.lesson_duration_minutes == null) {
            return yield* HttpError.make(
              404,
              "No rate configured for this location type. Please contact your teacher.",
            );
          }

          const rate = {
            rate_cents: preflight.rate_cents,
            lesson_duration_minutes: preflight.lesson_duration_minutes,
          };

          const lesson = yield* authDb
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
              "created_at",
            ])
            .pipe(Effect.head);
          yield* authDb.insertInto("app_public.lesson_deposits").values({
            lesson_id: lesson.id,
            amount_cents: Math.ceil(rate.rate_cents / 3),
            status: "held",
          });
          const connected = yield* GoogleCalendarService.isConnected();
          if (connected) {
            const studentName = values.userName || "Student";
            const eventId = yield* GoogleCalendarService.createEvent({
              summary: `Lesson: ${studentName}`,
              description: `${values.durationMinutes} min ${values.locationType.replace(/_/g, " ")} lesson`,
              start: values.scheduledAt.toISOString(),
              end: slotEnd.toISOString(),
            });
            if (eventId) {
              yield* authDb
                .updateTable("app_public.lessons")
                .set({ gcal_event_id: eventId })
                .where("id", "=", lesson.id);
            }
          }

          return lesson;
        }),
      };
    }),
  },
) {}
