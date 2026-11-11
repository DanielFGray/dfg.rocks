import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Schema as S } from "effect";
import { MonthlyPayment, MonthlyPaymentStatus, RecurringSchedule } from "../schemas.js";
import { params, BillingMonthQuery } from "./fields.js";
import { adminErrors } from "../httpApiErrors.js";

export const SaveRecurringSchedulePayload = S.Struct({
  id: S.optional(S.String),
  student_rate_id: S.String,
  day_of_week: S.Number.pipe(S.check(S.isInt()), S.check(S.isBetween({ minimum: 1, maximum: 7 }))),
  local_start_time: S.String,
  timezone: S.String,
  starts_on: S.String,
  ends_on: S.optional(S.NullishOr(S.String)),
  active: S.optional(S.Boolean),
});

export type SaveRecurringSchedulePayload = S.Schema.Type<typeof SaveRecurringSchedulePayload>;

export const RecordMonthlyPaymentPayload = S.Struct({
  billing_month: S.String,
  amount_cents: S.Number.pipe(S.check(S.isInt()), S.check(S.isGreaterThan(0))),
  paid_at: S.String,
  notes: S.optional(S.NullishOr(S.String)),
});

export type RecordMonthlyPaymentPayload = S.Schema.Type<typeof RecordMonthlyPaymentPayload>;

export const monthlyBillingAdminGroup = HttpApiGroup.make("monthlyBillingAdmin")
  .add(
    HttpApiEndpoint.get("recurringSchedules", "/students/:studentId/recurring-schedules", {
      error: adminErrors,
      params: params("studentId"),
      success: S.Array(RecurringSchedule),
    }),
  )
  .add(
    HttpApiEndpoint.post("saveRecurringSchedule", "/students/:studentId/recurring-schedules", {
      error: adminErrors,
      params: params("studentId"),
      payload: SaveRecurringSchedulePayload,
      success: RecurringSchedule,
    }),
  )
  .add(
    HttpApiEndpoint.get("monthlyPayments", "/students/:studentId/monthly-payments", {
      error: adminErrors,
      params: params("studentId"),
      success: S.Array(MonthlyPayment),
    }),
  )
  .add(
    HttpApiEndpoint.get("monthlyPaymentStatus", "/monthly-payments", {
      error: adminErrors,
      query: BillingMonthQuery,
      success: S.Array(MonthlyPaymentStatus),
    }),
  )
  .add(
    HttpApiEndpoint.post("recordMonthlyPayment", "/students/:studentId/monthly-payments", {
      error: adminErrors,
      params: params("studentId"),
      payload: RecordMonthlyPaymentPayload,
      success: MonthlyPayment,
    }),
  )
  .prefix("/api/admin");
