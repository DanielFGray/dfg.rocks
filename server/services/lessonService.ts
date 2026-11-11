import { Clock, Effect, Option, Context, Layer } from "effect";
import { sql } from "kysely";
import type { LessonStatus, LocationType } from "../../shared/schemas.js";
import { withAuthContext } from "../db.js";
import { catchPgErrors, HttpError } from "../pgErrors.js";
import { GoogleCalendarService } from "./googleCalendarService.js";
import { settleSingleBookingCancellation, singleBookingObligation } from "./singleBookingBills.js";
import { calculateDepositAmount } from "./billingCalculation.js";
import { LessonPolicyService } from "./lessonPolicyService.js";

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

export class LessonService extends Context.Service<LessonService>()("LessonService", {
  make: Effect.sync(() => {
    return {
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
          | "in_person_teacher_travels"
          | "in_person_student_travels"
          | "studio"
          | "online";
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
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
