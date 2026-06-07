import { sql } from "kysely";
import { Effect, Option } from "effect";
import { PgRootDB } from "../db.js";

const DEFAULT_INTERVAL_DAYS = 30;

function normalizeIntervalDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return DEFAULT_INTERVAL_DAYS;
  }

  return value >= 1 && value <= 365 ? value : DEFAULT_INTERVAL_DAYS;
}

const upsertUserReminderStateEffect = Effect.fnUntraced(function* (
  userId: string,
  values: {
    testimonial_prompt_enabled: boolean;
    testimonial_next_prompt_at: Date | null;
    testimonial_last_emailed_at?: Date | null;
  },
) {
  const rootDb = yield* PgRootDB;
  yield* rootDb
    .insertInto("app_private.user_secrets")
    .values({
      user_id: userId,
      testimonial_prompt_enabled: values.testimonial_prompt_enabled,
      testimonial_next_prompt_at: values.testimonial_next_prompt_at,
      testimonial_last_emailed_at: values.testimonial_last_emailed_at ?? null,
    })
    .onConflict((oc) =>
      oc.column("user_id").doUpdateSet({
        testimonial_prompt_enabled: values.testimonial_prompt_enabled,
        testimonial_next_prompt_at: values.testimonial_next_prompt_at,
        testimonial_last_emailed_at: values.testimonial_last_emailed_at ?? null,
      }),
    );
});

const getIntervalDaysEffect = Effect.fnUntraced(function* () {
  const rootDb = yield* PgRootDB;
  const row = yield* rootDb
    .selectFrom("app_private.admin_settings")
    .select("value")
    .where("key", "=", "testimonial_reminder_interval_days")
    .pipe(Effect.head, Effect.option);

  return normalizeIntervalDays(Option.getOrUndefined(row)?.value);
});

const setIntervalDaysEffect = Effect.fnUntraced(function* (
  intervalDays: number,
) {
  const rootDb = yield* PgRootDB;
  yield* rootDb
    .insertInto("app_private.admin_settings")
    .values({
      key: "testimonial_reminder_interval_days",
      value: sql`${JSON.stringify(intervalDays)}::jsonb`,
    })
    .onConflict((oc) =>
      oc.column("key").doUpdateSet({
        value: sql`${JSON.stringify(intervalDays)}::jsonb`,
      }),
    );
});

const getPromptEnabledEffect = Effect.fnUntraced(function* (userId: string) {
  const rootDb = yield* PgRootDB;
  const row = yield* rootDb
    .selectFrom("app_private.user_secrets")
    .select("testimonial_prompt_enabled")
    .where("user_id", "=", userId)
    .pipe(Effect.head, Effect.option);

  return Option.getOrUndefined(row)?.testimonial_prompt_enabled ?? false;
});

const clearReminderStateEffect = Effect.fnUntraced(function* (userId: string) {
  yield* upsertUserReminderStateEffect(userId, {
    testimonial_prompt_enabled: false,
    testimonial_next_prompt_at: null,
    testimonial_last_emailed_at: null,
  });
});

const scheduleNextReminderEffect = Effect.fnUntraced(function* (
  userId: string,
) {
  const intervalDays = yield* getIntervalDaysEffect();
  const nextPromptAt = new Date(
    Date.now() + intervalDays * 24 * 60 * 60 * 1000,
  );

  yield* upsertUserReminderStateEffect(userId, {
    testimonial_prompt_enabled: false,
    testimonial_next_prompt_at: nextPromptAt,
    testimonial_last_emailed_at: null,
  });
});

const rescheduleAllEffect = Effect.fnUntraced(function* (intervalDays: number) {
  const rootDb = yield* PgRootDB;
  yield* rootDb
    .insertInto("app_private.user_secrets")
    .columns(["user_id"])
    .expression((eb) => eb.selectFrom("app_public.users as users").select("users.id"))
    .onConflict((oc) => oc.column("user_id").doNothing());

  yield* rootDb
    .updateTable("app_private.user_secrets as secrets")
    .from("app_public.users as users")
    .leftJoin("app_public.testimonials as testimonials", "testimonials.user_id", "users.id")
    .set({
      testimonial_prompt_enabled: false,
      testimonial_next_prompt_at: sql`
        case
          when users.role in ('student', 'parent')
            and (testimonials.id is null or testimonials.is_approved = false)
            then now() + make_interval(days => ${intervalDays})
          else null
        end
      `,
      testimonial_last_emailed_at: sql`
        case
          when testimonials.id is null or testimonials.is_approved = false
            then secrets.testimonial_last_emailed_at
          else null
        end
      `,
    })
    .whereRef("users.id", "=", "secrets.user_id");
});

/**
 * Testimonial reminder scheduling service. Static methods return Effects.
 */
export class TestimonialReminderService extends Effect.Service<TestimonialReminderService>()(
  "TestimonialReminderService",
  {
    succeed: {
      getIntervalDays: getIntervalDaysEffect,
      setIntervalDays: setIntervalDaysEffect,
      getPromptEnabled: getPromptEnabledEffect,
      clearReminderState: clearReminderStateEffect,
      scheduleNextReminder: scheduleNextReminderEffect,
      rescheduleAll: rescheduleAllEffect,
    },
  },
) {
  static readonly getIntervalDays = getIntervalDaysEffect;
  static readonly setIntervalDays = setIntervalDaysEffect;
  static readonly getPromptEnabled = getPromptEnabledEffect;
  static readonly clearReminderState = clearReminderStateEffect;
  static readonly scheduleNextReminder = scheduleNextReminderEffect;
  static readonly rescheduleAll = rescheduleAllEffect;
}

// Legacy named-export aliases for call-sites that use the old functional API
export const getTestimonialReminderIntervalDays = getIntervalDaysEffect;
export const setTestimonialReminderIntervalDays = setIntervalDaysEffect;
export const getTestimonialPromptEnabled = getPromptEnabledEffect;
export const clearTestimonialReminderState = clearReminderStateEffect;
export const scheduleNextTestimonialReminder = scheduleNextReminderEffect;
export const rescheduleTestimonialReminders = rescheduleAllEffect;
