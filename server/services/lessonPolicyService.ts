import { Clock, Effect } from "effect";
import type {
  BillingModel,
  CancellationPolicySettings,
  DepositPolicyOutcome,
  FeePolicyOutcome,
  LessonCancellationPolicy,
} from "../../shared/schemas.js";
import { PgRootDB } from "../db.js";
import { sql } from "kysely";

export const DEFAULT_CANCELLATION_WINDOW_HOURS = 24;
export const DEFAULT_LATE_CANCEL_CHARGE_PERCENT = 50;

type CancellationPolicyInput = {
  billingModel: BillingModel;
  scheduledAt: Date;
  rateCents: number;
  heldDepositCents: number | null;
  settings: CancellationPolicySettings;
  now: Date;
};

export function calculateLessonCancellationPolicy(
  input: CancellationPolicyInput,
): LessonCancellationPolicy {
  const hoursUntilLesson =
    (input.scheduledAt.getTime() - input.now.getTime()) / (60 * 60 * 1000);
  const isLate = hoursUntilLesson < input.settings.cancellation_window_hours;

  let depositOutcome: DepositPolicyOutcome = "none";
  let feeOutcome: FeePolicyOutcome = "none";
  let amountCents = 0;

  if (input.billingModel === "single_booking" && input.heldDepositCents !== null) {
    depositOutcome = isLate ? "captured" : "refunded";
    amountCents = input.heldDepositCents;
  } else if (input.billingModel === "monthly_prepaid" && isLate) {
    feeOutcome = "recorded";
    amountCents = Math.round(
      (input.rateCents * input.settings.late_cancel_charge_percent) / 100,
    );
  }

  return {
    billing_model: input.billingModel,
    hours_until_lesson: hoursUntilLesson,
    is_late: isLate,
    deposit_outcome: depositOutcome,
    fee_outcome: feeOutcome,
    amount_cents: amountCents,
  };
}

function numberSetting(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export class LessonPolicyService extends Effect.Service<LessonPolicyService>()(
  "LessonPolicyService",
  {
    accessors: true,
    effect: Effect.gen(function* () {
      const rootDb = yield* PgRootDB;

      const getSettings = Effect.fn("getCancellationPolicySettings")(function* () {
        const rows = yield* rootDb
          .selectFrom("app_private.admin_settings")
          .select(["key", "value"])
          .where("key", "in", ["cancellation_window_hours", "late_cancel_charge_percent"]);
        const settings = new Map(rows.map((row) => [row.key, row.value]));
        return {
          cancellation_window_hours: numberSetting(
            settings.get("cancellation_window_hours"),
            DEFAULT_CANCELLATION_WINDOW_HOURS,
          ),
          late_cancel_charge_percent: numberSetting(
            settings.get("late_cancel_charge_percent"),
            DEFAULT_LATE_CANCEL_CHARGE_PERCENT,
          ),
        } satisfies CancellationPolicySettings;
      });

      return {
        getSettings,

        hasScheduledOverlap: Effect.fn("hasScheduledLessonOverlap")(function* (values: {
          lessonId?: string;
          scheduledAt: Date;
          durationMinutes: number;
        }) {
          const slotEnd = new Date(
            values.scheduledAt.getTime() + values.durationMinutes * 60 * 1000,
          );
          let query = rootDb
            .selectFrom("app_public.lessons")
            .select((eb) => eb.fn.countAll<number>().as("overlap_count"))
            .where("status", "=", "scheduled")
            .where("scheduled_at", "<", slotEnd)
            .where(
              sql`scheduled_at + (duration_minutes || ' minutes')::interval`,
              ">",
              values.scheduledAt,
            );
          if (values.lessonId) query = query.where("id", "!=", values.lessonId);
          const result = yield* query.pipe(Effect.head);
          return result.overlap_count > 0;
        }),

        saveSettings: Effect.fn("saveCancellationPolicySettings")(function* (
          settings: CancellationPolicySettings,
        ) {
          yield* rootDb
            .insertInto("app_private.admin_settings")
            .values([
              {
                key: "cancellation_window_hours",
                value: JSON.stringify(settings.cancellation_window_hours),
              },
              {
                key: "late_cancel_charge_percent",
                value: JSON.stringify(settings.late_cancel_charge_percent),
              },
            ])
            .onConflict((oc) => oc.column("key").doUpdateSet((eb) => ({ value: eb.ref("excluded.value") })));
          return settings;
        }),

        evaluate: Effect.fn("evaluateLessonCancellationPolicy")(function* (
          input: Omit<CancellationPolicyInput, "settings" | "now"> & {
            settings?: CancellationPolicySettings;
            now?: Date;
          },
        ) {
          const settings = input.settings ?? (yield* getSettings());
          const now = input.now ?? new Date(yield* Clock.currentTimeMillis);
          return calculateLessonCancellationPolicy({ ...input, settings, now });
        }),
      };
    }),
  },
) {}
