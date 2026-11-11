import { Effect, Option, Context, Layer } from "effect";
import type { ColumnType, Generated } from "kysely";
import type { DB } from "../../generated/db.js";
import type {
  MonthlyPayment,
  PaymentGenerationStatus,
  RecurringSchedule,
} from "../../shared/schemas.js";
import { type Database, withAuthContext } from "../db.js";
import { HttpError } from "../pgErrors.js";

type Timestamp = ColumnType<Date, Date | string, Date | string>;

interface RecurringSchedulesTable {
  id: Generated<string>;
  student_rate_id: string;
  day_of_week: number;
  local_start_time: string;
  timezone: string;
  starts_on: string;
  ends_on: string | null;
  active: Generated<boolean>;
}

interface MonthlyPaymentsTable {
  id: Generated<string>;
  student_id: string;
  billing_month: string;
  amount_cents: number;
  paid_at: Timestamp;
  notes: string | null;
  generation_status: PaymentGenerationStatus;
  generation_error: string | null;
  generated_at: Timestamp | null;
}

type RecurringDB = Omit<DB, "app_public.recurring_schedules" | "app_public.monthly_payments"> & {
  "app_public.recurring_schedules": RecurringSchedulesTable;
  "app_public.monthly_payments": MonthlyPaymentsTable;
};

export interface SaveRecurringScheduleInput {
  id?: string;
  studentRateId: string;
  dayOfWeek: number;
  localStartTime: string;
  timezone: string;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
}

export interface RecordMonthlyPaymentInput {
  studentId: string;
  billingMonth: string;
  amountCents: number;
  paidAt: Date;
  notes: string | null;
}

const scheduleColumns = [
  "rs.id",
  "rs.student_rate_id",
  "sr.student_id",
  "rs.day_of_week",
  "rs.local_start_time",
  "rs.timezone",
  "rs.starts_on",
  "rs.ends_on",
  "rs.active",
] as const;

const paymentColumns = [
  "id",
  "student_id",
  "billing_month",
  "amount_cents",
  "paid_at",
  "notes",
  "generation_status",
  "generation_error",
  "generated_at",
] as const;

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

export function serializeRecurringSchedule(row: {
  id: string;
  student_rate_id: string;
  student_id: string;
  day_of_week: number;
  local_start_time: string;
  timezone: string;
  starts_on: Date | string;
  ends_on: Date | string | null;
  active: boolean;
}): RecurringSchedule {
  return {
    ...row,
    starts_on: dateOnly(row.starts_on),
    ends_on: row.ends_on === null ? null : dateOnly(row.ends_on),
  };
}

export function serializeMonthlyPayment(row: {
  id: string;
  student_id: string;
  billing_month: Date | string;
  amount_cents: number;
  paid_at: Date;
  notes: string | null;
  generation_status: PaymentGenerationStatus;
  generation_error: string | null;
  generated_at: Date | null;
}): MonthlyPayment {
  return {
    ...row,
    billing_month: dateOnly(row.billing_month),
  };
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isFirstOfMonth(value: string): boolean {
  return isIsoDate(value) && value.endsWith("-01");
}

export function validateRecurringSchedule(input: SaveRecurringScheduleInput): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 1 || input.dayOfWeek > 7) {
    errors.push("day_of_week must be an ISO weekday from 1 through 7");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(input.localStartTime)) {
    errors.push("local_start_time must be HH:mm or HH:mm:ss");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    errors.push("timezone must be a valid IANA time zone");
  }
  if (!isIsoDate(input.startsOn)) {
    errors.push("starts_on must be a valid ISO date");
  }
  if (input.endsOn !== null && !isIsoDate(input.endsOn)) {
    errors.push("ends_on must be a valid ISO date");
  } else if (input.endsOn !== null && input.endsOn < input.startsOn) {
    errors.push("ends_on must not be before starts_on");
  }
  return errors;
}

export class RecurringScheduleService extends Context.Service<RecurringScheduleService>()(
  "RecurringScheduleService",
  {
    make: Effect.succeed({
      listSchedules: Effect.fn("listRecurringSchedulesForStudent")(function* (
        sessionId: string,
        studentId: string,
      ) {
        return yield* withAuthContext(sessionId, (baseDb) => {
          const db = baseDb as unknown as Database<RecurringDB>;
          return db.execute(
            db
              .selectFrom("app_public.recurring_schedules as rs")
              .innerJoin("app_public.student_rates as sr", "sr.id", "rs.student_rate_id")
              .select(scheduleColumns)
              .where("sr.student_id", "=", studentId)
              .orderBy("rs.day_of_week")
              .orderBy("rs.local_start_time"),
          );
        });
      }),

      saveSchedule: Effect.fn("saveRecurringScheduleForStudent")(function* (values: {
        sessionId: string;
        studentId: string;
        id?: string;
        schedule: Omit<SaveRecurringScheduleInput, "id">;
      }) {
        const { sessionId, studentId } = values;
        const input: SaveRecurringScheduleInput = {
          ...values.schedule,
          id: values.id,
        };
        const validationErrors = validateRecurringSchedule(input);
        if (validationErrors.length > 0) {
          return yield* new HttpError(400, validationErrors.join("; "));
        }
        return yield* withAuthContext(
          sessionId,
          Effect.fnUntraced(function* (baseDb) {
            const db = baseDb as unknown as Database<RecurringDB>;
            const rate = yield* db
              .execute(
                db
                  .selectFrom("app_public.student_rates")
                  .select(["id", "billing_model"])
                  .where("id", "=", input.studentRateId)
                  .where("student_id", "=", studentId),
              )
              .pipe(Effect.head, Effect.option);
            const studentRate = Option.getOrNull(rate);
            if (!studentRate) {
              return yield* new HttpError(404, "Student rate not found");
            }
            if (studentRate.billing_model !== "monthly_prepaid") {
              return yield* new HttpError(
                409,
                "Recurring schedules require a monthly prepaid rate",
              );
            }

            const values = {
              student_rate_id: input.studentRateId,
              day_of_week: input.dayOfWeek,
              local_start_time: input.localStartTime,
              timezone: input.timezone,
              starts_on: input.startsOn,
              ends_on: input.endsOn,
              active: input.active,
            };
            let scheduleId = input.id;
            if (scheduleId) {
              const existing = yield* db
                .execute(
                  db
                    .selectFrom("app_public.recurring_schedules as rs")
                    .innerJoin("app_public.student_rates as sr", "sr.id", "rs.student_rate_id")
                    .select("rs.id")
                    .where("rs.id", "=", scheduleId)
                    .where("sr.student_id", "=", studentId),
                )
                .pipe(Effect.head, Effect.option);
              if (Option.isNone(existing)) {
                return yield* new HttpError(404, "Recurring schedule not found");
              }
              yield* db.execute(
                db
                  .updateTable("app_public.recurring_schedules")
                  .set(values)
                  .where("id", "=", scheduleId),
              );
            } else {
              const inserted = yield* db
                .execute(
                  db.insertInto("app_public.recurring_schedules").values(values).returning("id"),
                )
                .pipe(Effect.head);
              scheduleId = inserted.id;
            }
            return yield* db
              .execute(
                db
                  .selectFrom("app_public.recurring_schedules as rs")
                  .innerJoin("app_public.student_rates as sr", "sr.id", "rs.student_rate_id")
                  .select(scheduleColumns)
                  .where("rs.id", "=", scheduleId),
              )
              .pipe(Effect.head);
          }),
        );
      }),

      listPayments: Effect.fn("listMonthlyPaymentsForStudent")(function* (
        sessionId: string,
        studentId: string,
      ) {
        return yield* withAuthContext(sessionId, (baseDb) => {
          const db = baseDb as unknown as Database<RecurringDB>;
          return db.execute(
            db
              .selectFrom("app_public.monthly_payments")
              .select(paymentColumns)
              .where("student_id", "=", studentId)
              .orderBy("billing_month", "desc"),
          );
        });
      }),

      listMonth: Effect.fn("listMonthlyPaymentStatus")(function* (
        sessionId: string,
        billingMonth: string,
      ) {
        if (!isFirstOfMonth(billingMonth)) {
          return yield* new HttpError(400, "month must be the first day of a month (YYYY-MM-01)");
        }
        const rows = yield* withAuthContext(sessionId, (baseDb) => {
          const db = baseDb as unknown as Database<RecurringDB>;
          return db.execute(
            db
              .selectFrom("app_public.users as u")
              .leftJoin("app_public.monthly_payments as mp", (join) =>
                join.onRef("mp.student_id", "=", "u.id").on("mp.billing_month", "=", billingMonth),
              )
              .select([
                "u.id as student_id",
                "u.name",
                "u.username",
                "mp.id",
                "mp.billing_month",
                "mp.amount_cents",
                "mp.paid_at",
                "mp.notes",
                "mp.generation_status",
                "mp.generation_error",
                "mp.generated_at",
              ])
              // A recorded payment keeps its student listed after the schedule ends.
              .where((eb) =>
                eb.or([
                  eb("u.id", "in", monthlyPrepaidStudents(db, billingMonth)),
                  eb("mp.id", "is not", null),
                ]),
              )
              .orderBy("u.name")
              .orderBy("u.username"),
          );
        });
        return rows.map(({ student_id, name, username, ...mp }) => ({
          student_id,
          student_name: name ?? username,
          payment:
            mp.id === null ||
            mp.billing_month === null ||
            mp.amount_cents === null ||
            mp.paid_at === null ||
            mp.generation_status === null
              ? null
              : {
                  ...mp,
                  id: mp.id,
                  student_id,
                  billing_month: mp.billing_month,
                  amount_cents: mp.amount_cents,
                  paid_at: mp.paid_at,
                  generation_status: mp.generation_status,
                },
        }));
      }),

      recordPayment: Effect.fn("recordMonthlyPayment")(function* (
        values: {
          sessionId: string;
        } & RecordMonthlyPaymentInput,
      ) {
        const { sessionId, ...input } = values;
        if (!isFirstOfMonth(input.billingMonth)) {
          return yield* new HttpError(
            400,
            "billing_month must be the first day of a month (YYYY-MM-01)",
          );
        }
        if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
          return yield* new HttpError(400, "amount_cents must be a positive integer");
        }
        if (Number.isNaN(input.paidAt.getTime())) {
          return yield* new HttpError(400, "paid_at must be a valid timestamp");
        }

        return yield* withAuthContext(
          sessionId,
          Effect.fnUntraced(function* (baseDb) {
            const db = baseDb as unknown as Database<RecurringDB>;
            const eligible = yield* db
              .execute(
                monthlyPrepaidStudents(db, input.billingMonth)
                  .where("sr.student_id", "=", input.studentId)
                  .limit(1),
              )
              .pipe(Effect.head, Effect.option);
            if (Option.isNone(eligible)) {
              return yield* new HttpError(
                409,
                "Student has no active monthly prepaid recurring schedule for this billing month",
              );
            }

            const inserted = yield* db
              .execute(
                db
                  .insertInto("app_public.monthly_payments")
                  .values({
                    student_id: input.studentId,
                    billing_month: input.billingMonth,
                    amount_cents: input.amountCents,
                    paid_at: input.paidAt,
                    notes: input.notes,
                    generation_status: "pending",
                    generation_error: null,
                    generated_at: null,
                  })
                  .onConflict((oc) => oc.columns(["student_id", "billing_month"]).doNothing())
                  .returning(paymentColumns),
              )
              .pipe(Effect.head, Effect.option);

            let payment;
            let shouldEnqueue = false;
            if (Option.isSome(inserted)) {
              payment = inserted.value;
              shouldEnqueue = true;
            } else {
              payment = yield* db
                .execute(
                  db
                    .selectFrom("app_public.monthly_payments")
                    .select(paymentColumns)
                    .where("student_id", "=", input.studentId)
                    .where("billing_month", "=", input.billingMonth)
                    .forUpdate(),
                )
                .pipe(Effect.head);
              if (
                payment.amount_cents !== input.amountCents ||
                payment.paid_at.getTime() !== input.paidAt.getTime() ||
                (payment.notes ?? null) !== input.notes
              ) {
                return yield* new HttpError(
                  409,
                  "A payment already exists for this month with different immutable details",
                );
              }
              if (payment.generation_status === "failed") {
                payment = yield* db
                  .execute(
                    db
                      .updateTable("app_public.monthly_payments")
                      .set({
                        generation_status: "pending",
                        generation_error: null,
                        generated_at: null,
                      })
                      .where("id", "=", payment.id)
                      .returning(paymentColumns),
                  )
                  .pipe(Effect.head);
                shouldEnqueue = true;
              }
            }

            if (shouldEnqueue) {
              yield* db.execute(
                db.selectNoFrom((eb) =>
                  eb
                    .fn<unknown>("app_public.enqueue_prepaid_lesson_generation", [
                      eb.val(payment.id),
                    ])
                    .as("add_job"),
                ),
              );
            }
            return payment;
          }),
        );
      }),
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}

/**
 * Students who owe a monthly prepaid payment for the billing month: those with an
 * active monthly prepaid schedule that overlaps the month. Recording a payment
 * and listing the month both use this rule, so the list never shows a student
 * whose payment the API would refuse.
 */
function monthlyPrepaidStudents(db: Database<RecurringDB>, billingMonth: string) {
  const nextMonth = new Date(`${billingMonth}T00:00:00.000Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const lastDay = new Date(nextMonth.getTime() - 86_400_000).toISOString().slice(0, 10);
  return db
    .selectFrom("app_public.recurring_schedules as rs")
    .innerJoin("app_public.student_rates as sr", "sr.id", "rs.student_rate_id")
    .select("sr.student_id")
    .where("sr.billing_model", "=", "monthly_prepaid")
    .where("rs.active", "=", true)
    .where("rs.starts_on", "<=", lastDay)
    .where((eb) => eb.or([eb("rs.ends_on", "is", null), eb("rs.ends_on", ">=", billingMonth)]));
}
