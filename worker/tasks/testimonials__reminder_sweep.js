/** @typedef {import("graphile-worker").Task} Task */

const DEFAULT_INTERVAL_DAYS = 30;
const DEFAULT_ROOT_URL = "http://localhost:3000";

function normalizeIntervalDays(value) {
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : DEFAULT_INTERVAL_DAYS;
}

/** @type {Task} */
export default async (_payload, { addJob, logger, withPgClient }) => {
  const {
    rows: [settingsRow],
  } = await withPgClient((pgClient) =>
    pgClient.query(
      `select value
       from app_private.admin_settings
       where key = 'testimonial_reminder_interval_days'`,
    ),
  );

  const intervalDays = normalizeIntervalDays(settingsRow?.value);
  const rootUrl = process.env.VITE_ROOT_URL ?? DEFAULT_ROOT_URL;

  const { rows: dueUsers } = await withPgClient((pgClient) =>
    pgClient.query(
      `select
         users.id,
         coalesce(primary_email.email, '') as email,
         coalesce(nullif(users.name, ''), users.username) as display_name
       from app_private.user_secrets as secrets
       inner join app_public.users as users
         on users.id = secrets.user_id
       left join app_public.testimonials as testimonials
         on testimonials.user_id = users.id
       left join lateral (
         select email
         from app_public.user_emails
         where user_id = users.id
           and is_primary = true
         limit 1
       ) as primary_email on true
       where users.role in ('student', 'parent')
         and testimonials.id is null
         and secrets.testimonial_next_prompt_at is not null
         and secrets.testimonial_next_prompt_at <= now()`,
    ),
  );

  for (const user of dueUsers) {
    if (!user.email) {
      logger.error(`Skipping testimonial reminder for ${user.id}: no primary email`);
      continue;
    }

    await addJob("send_email", {
      options: {
        to: user.email,
        subject: "How would you recommend DFG Music Lessons?",
      },
      template: "testimonial_reminder.mjml",
      variables: {
        displayName: user.display_name,
        testimonialLink: `${rootUrl}/dashboard`,
      },
    });

    await withPgClient((pgClient) =>
      pgClient.query(
        `update app_private.user_secrets
         set testimonial_prompt_enabled = true,
             testimonial_last_emailed_at = now(),
             testimonial_next_prompt_at = now() + make_interval(days => $2)
         where user_id = $1`,
        [user.id, intervalDays],
      ),
    );
  }
};
