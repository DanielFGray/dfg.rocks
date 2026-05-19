import { sql } from "kysely";
import { rootDb } from "../db.js";

const DEFAULT_INTERVAL_DAYS = 30;

function normalizeIntervalDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return DEFAULT_INTERVAL_DAYS;
  }

  return value >= 1 && value <= 365 ? value : DEFAULT_INTERVAL_DAYS;
}

async function upsertUserReminderState(
  userId: string,
  values: {
    testimonial_prompt_enabled: boolean;
    testimonial_next_prompt_at: Date | null;
    testimonial_last_emailed_at?: Date | null;
  },
): Promise<void> {
  await rootDb
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
    )
    .execute();
}

export async function getTestimonialReminderIntervalDays(): Promise<number> {
  const row = await rootDb
    .selectFrom("app_private.admin_settings")
    .select("value")
    .where("key", "=", "testimonial_reminder_interval_days")
    .executeTakeFirst();

  return normalizeIntervalDays(row?.value);
}

export async function setTestimonialReminderIntervalDays(intervalDays: number): Promise<void> {
  await rootDb
    .insertInto("app_private.admin_settings")
    .values({
      key: "testimonial_reminder_interval_days",
      value: sql`${JSON.stringify(intervalDays)}::jsonb`,
    })
    .onConflict((oc) =>
      oc.column("key").doUpdateSet({
        value: sql`${JSON.stringify(intervalDays)}::jsonb`,
      }),
    )
    .execute();
}

export async function getTestimonialPromptEnabled(userId: string): Promise<boolean> {
  const row = await rootDb
    .selectFrom("app_private.user_secrets")
    .select("testimonial_prompt_enabled")
    .where("user_id", "=", userId)
    .executeTakeFirst();

  return row?.testimonial_prompt_enabled ?? false;
}

export async function clearTestimonialReminderState(userId: string): Promise<void> {
  await upsertUserReminderState(userId, {
    testimonial_prompt_enabled: false,
    testimonial_next_prompt_at: null,
    testimonial_last_emailed_at: null,
  });
}

export async function scheduleNextTestimonialReminder(userId: string): Promise<void> {
  const intervalDays = await getTestimonialReminderIntervalDays();
  const nextPromptAt = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);

  await upsertUserReminderState(userId, {
    testimonial_prompt_enabled: false,
    testimonial_next_prompt_at: nextPromptAt,
    testimonial_last_emailed_at: null,
  });
}

export async function rescheduleTestimonialReminders(intervalDays: number): Promise<void> {
  await sql`
    insert into app_private.user_secrets (user_id)
    select users.id
    from app_public.users as users
    on conflict (user_id) do nothing
  `.execute(rootDb);

  await sql`
    update app_private.user_secrets as secrets
    set testimonial_prompt_enabled = false,
        testimonial_next_prompt_at = case
          when users.role in ('student', 'parent') and testimonials.id is null
            then now() + make_interval(days => ${intervalDays})
          else null
        end,
        testimonial_last_emailed_at = case
          when testimonials.id is null then secrets.testimonial_last_emailed_at
          else null
        end
    from app_public.users as users
    left join app_public.testimonials as testimonials
      on testimonials.user_id = users.id
    where users.id = secrets.user_id
  `.execute(rootDb);
}
