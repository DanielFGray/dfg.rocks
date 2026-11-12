import { sql } from "kysely";
import { Effect, Option, Context, Layer } from "effect";
import { PgRootDB } from "../db.js";

const DEFAULT_INTERVAL_DAYS = 30;

function normalizeIntervalDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return DEFAULT_INTERVAL_DAYS;
  }

  return value >= 1 && value <= 365 ? value : DEFAULT_INTERVAL_DAYS;
}

/**
 * Testimonial reminder scheduling service backed by the root database.
 */
export class TestimonialReminder extends Context.Service<TestimonialReminder>()(
  "dfg-rocks/testimonialReminder",
  {
    make: Effect.gen(function* () {
      const rootDb = yield* PgRootDB;

      const upsertUserReminderState = Effect.fnUntraced(function* (
        userId: string,
        values: {
          testimonial_prompt_enabled: boolean;
          testimonial_next_prompt_at: Date | null;
          testimonial_last_emailed_at?: Date | null;
        },
      ) {
        yield* rootDb.execute(
          rootDb
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
            ),
        );
      });

      const getIntervalDays = Effect.fnUntraced(function* () {
        const row = yield* rootDb
          .execute(
            rootDb
              .selectFrom("app_private.admin_settings")
              .select("value")
              .where("key", "=", "testimonial_reminder_interval_days"),
          )
          .pipe(Effect.head, Effect.option);

        return normalizeIntervalDays(Option.getOrUndefined(row)?.value);
      });

      const setIntervalDays = Effect.fnUntraced(function* (intervalDays: number) {
        yield* rootDb.execute(
          rootDb
            .insertInto("app_private.admin_settings")
            .values({
              key: "testimonial_reminder_interval_days",
              value: sql`${JSON.stringify(intervalDays)}::jsonb`,
            })
            .onConflict((oc) =>
              oc.column("key").doUpdateSet({
                value: sql`${JSON.stringify(intervalDays)}::jsonb`,
              }),
            ),
        );
      });

      const getPromptEnabled = Effect.fnUntraced(function* (userId: string) {
        const row = yield* rootDb
          .execute(
            rootDb
              .selectFrom("app_private.user_secrets")
              .select("testimonial_prompt_enabled")
              .where("user_id", "=", userId),
          )
          .pipe(Effect.head, Effect.option);

        return Option.getOrUndefined(row)?.testimonial_prompt_enabled ?? false;
      });

      const clearReminderState = Effect.fnUntraced(function* (userId: string) {
        yield* upsertUserReminderState(userId, {
          testimonial_prompt_enabled: false,
          testimonial_next_prompt_at: null,
          testimonial_last_emailed_at: null,
        });
      });

      const scheduleNextReminder = Effect.fnUntraced(function* (userId: string) {
        const intervalDays = yield* getIntervalDays();
        const nextPromptAt = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);

        yield* upsertUserReminderState(userId, {
          testimonial_prompt_enabled: false,
          testimonial_next_prompt_at: nextPromptAt,
          testimonial_last_emailed_at: null,
        });
      });

      const rescheduleAll = Effect.fnUntraced(function* (intervalDays: number) {
        yield* rootDb.execute(
          rootDb
            .insertInto("app_private.user_secrets")
            .columns(["user_id"])
            .expression((eb) => eb.selectFrom("app_public.users as users").select("users.id"))
            .onConflict((oc) => oc.column("user_id").doNothing()),
        );

        yield* rootDb.execute(
          rootDb
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
            .whereRef("users.id", "=", "secrets.user_id"),
        );
      });

      return {
        getIntervalDays,
        setIntervalDays,
        getPromptEnabled,
        clearReminderState,
        scheduleNextReminder,
        rescheduleAll,
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(PgRootDB.layer));
}
