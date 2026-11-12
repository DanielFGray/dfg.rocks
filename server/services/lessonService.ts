import { Clock, Effect, Option, Context, Layer } from "effect";
import { sql } from "kysely";
import type { LessonStatus, LocationType } from "../../shared/schemas.js";
import { RequestDatabase } from "../requestDatabase.js";
import { catchPgErrors, HttpError } from "../pgErrors.js";
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
        studentId: string;
        scheduledAt: Date;
        durationMinutes: number;
        locationType: LocationType;
        gcalEventId: string | null;
      }) {
        const lesson = yield* RequestDatabase.use(
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
        return lesson;
      }),

      updateLesson: Effect.fn("updateLesson")(function* (
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
        const lesson = yield* RequestDatabase.use((db) =>
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

      deleteLesson: Effect.fn("deleteLesson")(function* (id: string) {
        const lesson = yield* RequestDatabase.use(
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
        return lesson;
      }),

      cancelLesson: Effect.fn("cancelLesson")(function* (id: string, reason: string | null) {
        const now = new Date();
        const lesson = yield* RequestDatabase.use(
          Effect.fnUntraced(function* (db) {
            const existing = yield* db
              .execute(
                db
                  .selectFrom("app_public.lessons")
                  .select(["id", "status"])
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
            return lesson;
          }),
        );
        return lesson;
      }),

      completeLesson: Effect.fn("completeLesson")(function* (id: string) {
        const now = new Date();
        return yield* RequestDatabase.use(
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

      listLessons: Effect.fn("listLessons")(function* (filters: {
        limit: number;
        offset: number;
        studentId?: string;
        status?: LessonStatus;
        from?: Date;
        to?: Date;
      }) {
        return yield* RequestDatabase.use((db) => {
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
        return yield* RequestDatabase.use((db) =>
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

      getLessonNote: Effect.fn("getLessonNote")(function* (lessonId: string) {
        return yield* RequestDatabase.use((db) =>
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

      publishLessonNote: Effect.fn("publishLessonNote")(function* (lessonId: string) {
        return yield* RequestDatabase.use((db) =>
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
        values: {
          limit: number;
          offset: number;
          status?: string;
          from?: string;
          to?: string;
        },
        studentId?: string,
      ) {
        return yield* RequestDatabase.use(
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

      myLessonById: Effect.fn("myLessonById")(function* (lessonId: string) {
        return yield* RequestDatabase.use(
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

      myLessonNotes: Effect.fn("myLessonNotes")(function* (lessonId: string) {
        return yield* RequestDatabase.use(
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
        values: {
          limit: number;
          offset: number;
        },
        studentId?: string,
      ) {
        return yield* RequestDatabase.use((db) => {
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
        studentId: string;
        lessonId: string;
      }) {
        const row = yield* RequestDatabase.use((db) =>
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
        const deposit = yield* RequestDatabase.use((db) =>
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
        studentId: string;
        lessonId: string;
        reason: string | null;
      }) {
        const settings = yield* LessonPolicyService.use((lessonPolicyService) =>
          lessonPolicyService.getSettings(),
        );
        const now = new Date(yield* Clock.currentTimeMillis);
        const lesson = yield* RequestDatabase.use(
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
            return lesson;
          }),
        );
        return lesson;
      }),

      rescheduleMyLesson: Effect.fn("rescheduleMyLesson")(function* (values: {
        studentId: string;
        lessonId: string;
        scheduledAt: Date;
      }) {
        const now = new Date(yield* Clock.currentTimeMillis);
        if (!Number.isFinite(values.scheduledAt.getTime()) || values.scheduledAt <= now) {
          return yield* new HttpError(400, "The new lesson time must be in the future");
        }
        const existing = yield* RequestDatabase.use((db) =>
          db
            .execute(
              db
                .selectFrom("app_public.lessons")
                .select(["scheduled_at", "duration_minutes", "status"])
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

        const settings = yield* LessonPolicyService.use((lessonPolicyService) =>
          lessonPolicyService.getSettings(),
        );
        return yield* RequestDatabase.use(
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
      }),

      bookLesson: Effect.fn("bookLesson")(function* (values: {
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

        const { lesson } = yield* RequestDatabase.use(
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

        return lesson;
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
