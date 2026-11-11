import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import {
  RecurringScheduleService,
  serializeMonthlyPayment,
  serializeRecurringSchedule,
} from "../services/recurringScheduleService.js";
import { adaptAdminErrors } from "../httpApiErrors.js";

export const MonthlyBillingAdminApiGroupLive = HttpApiBuilder.group(
  Contract,
  "monthlyBillingAdmin",
  (handlers) =>
    handlers
      .handle(
        "recurringSchedules",
        Effect.fnUntraced(function* ({ params }) {
          const auth = yield* CurrentSession;
          const rows = yield* RecurringScheduleService.use((recurringScheduleService) =>
            recurringScheduleService.listSchedules(auth.session.id, params.studentId),
          );
          return rows.map(serializeRecurringSchedule);
        }, adaptAdminErrors),
      )
      .handle(
        "saveRecurringSchedule",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          const row = yield* RecurringScheduleService.use((recurringScheduleService) =>
            recurringScheduleService.saveSchedule({
              sessionId: auth.session.id,
              studentId: params.studentId,
              id: payload.id,
              schedule: {
                studentRateId: payload.student_rate_id,
                dayOfWeek: payload.day_of_week,
                localStartTime: payload.local_start_time,
                timezone: payload.timezone,
                startsOn: payload.starts_on,
                endsOn: payload.ends_on ?? null,
                active: payload.active ?? true,
              },
            }),
          );
          return serializeRecurringSchedule(row);
        }, adaptAdminErrors),
      )
      .handle(
        "monthlyPayments",
        Effect.fnUntraced(function* ({ params }) {
          const auth = yield* CurrentSession;
          const rows = yield* RecurringScheduleService.use((recurringScheduleService) =>
            recurringScheduleService.listPayments(auth.session.id, params.studentId),
          );
          return rows.map(serializeMonthlyPayment);
        }, adaptAdminErrors),
      )
      .handle(
        "monthlyPaymentStatus",
        Effect.fnUntraced(function* ({ query }) {
          const auth = yield* CurrentSession;
          const rows = yield* RecurringScheduleService.use((recurringScheduleService) =>
            recurringScheduleService.listMonth(auth.session.id, query.month),
          );
          return rows.map((row) => ({
            ...row,
            payment: row.payment === null ? null : serializeMonthlyPayment(row.payment),
          }));
        }, adaptAdminErrors),
      )
      .handle(
        "recordMonthlyPayment",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          const row = yield* RecurringScheduleService.use((recurringScheduleService) =>
            recurringScheduleService.recordPayment({
              sessionId: auth.session.id,
              studentId: params.studentId,
              billingMonth: payload.billing_month,
              amountCents: payload.amount_cents,
              paidAt: new Date(payload.paid_at),
              notes: payload.notes ?? null,
            }),
          );
          return serializeMonthlyPayment(row);
        }, adaptAdminErrors),
      ),
);
