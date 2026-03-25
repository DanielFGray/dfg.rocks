/** @typedef {import("./send_email").SendEmailPayload} SendEmailPayload */
/** @typedef {import("graphile-worker").Task} Task */

/** @typedef {{
  type: string;
  user_id: string;
  current_user_id: string | null;
  timestamp: string;
  service?: string;
}} UserAuditPayload */

const EVENT_DESCRIPTIONS = {
  password_change: "Your password was changed",
  oauth_link: "A new login method was linked to your account",
  oauth_unlink: "A login method was removed from your account",
};

/** @type {Task} */
export default async (inPayload, { addJob, withPgClient }) => {
  /** @type {UserAuditPayload} */
  const payload = inPayload;
  const { type, user_id: userId, current_user_id: currentUserId, service } = payload;

  const description = EVENT_DESCRIPTIONS[type];
  if (!description) {
    console.warn(`Unknown audit event type: ${type}`);
    return;
  }

  const {
    rows: [user],
  } = await withPgClient((pgClient) =>
    pgClient.query(
      `select id, email, name from app_public.users where id = $1`,
      [userId],
    ),
  );
  if (!user) {
    console.error("User not found for audit notification; aborting");
    return;
  }

  let detail = description;
  if (service) {
    detail += ` (${service})`;
  }
  if (currentUserId && currentUserId !== userId) {
    detail += " by an administrator";
  }

  /** @type {SendEmailPayload} */
  const sendEmailPayload = {
    options: {
      to: user.email,
      subject: `Security alert: ${description.toLowerCase()}`,
    },
    template: "account_activity.mjml",
    variables: {
      userName: user.name || user.email,
      eventDescription: detail,
      eventTime: new Date(payload.timestamp).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    },
  };
  await addJob("send_email", sendEmailPayload);
};
