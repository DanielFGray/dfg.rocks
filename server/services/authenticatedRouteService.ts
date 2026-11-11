import { Clock, Effect, Option, Context, Layer } from "effect";
import { sql } from "kysely";
import type { LessonStatus } from "../../shared/schemas.js";
import { withAuthContext } from "../db.js";
import { HttpError } from "../pgErrors.js";
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

export class AuthenticatedRouteService extends Context.Service<AuthenticatedRouteService>()(
  "AuthenticatedRouteService",
  {
    make: Effect.sync(() => {
      return {
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
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
