import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { RecurringSchedule } from "../services/recurringSchedule.js";
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
          return yield* RecurringSchedule.use((recurringScheduleService) =>
            recurringScheduleService
              .listSchedules(params.studentId)
              .pipe(withAuthContext(auth.session.id)),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "saveRecurringSchedule",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          return yield* RecurringSchedule.use((recurringScheduleService) =>
            recurringScheduleService
              .saveSchedule({
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
              })
              .pipe(withAuthContext(auth.session.id)),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "monthlyPayments",
        Effect.fnUntraced(function* ({ params }) {
          const auth = yield* CurrentSession;
          return yield* RecurringSchedule.use((recurringScheduleService) =>
            recurringScheduleService
              .listPayments(params.studentId)
              .pipe(withAuthContext(auth.session.id)),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "monthlyPaymentStatus",
        Effect.fnUntraced(function* ({ query }) {
          const auth = yield* CurrentSession;
          return yield* RecurringSchedule.use((recurringScheduleService) =>
            recurringScheduleService.listMonth(query.month).pipe(withAuthContext(auth.session.id)),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "recordMonthlyPayment",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          return yield* RecurringSchedule.use((recurringScheduleService) =>
            recurringScheduleService
              .recordPayment({
                studentId: params.studentId,
                billingMonth: payload.billing_month,
                amountCents: payload.amount_cents,
                paidAt: payload.paid_at,
                notes: payload.notes ?? null,
              })
              .pipe(withAuthContext(auth.session.id)),
          );
        }, adaptAdminErrors),
      ),
);
