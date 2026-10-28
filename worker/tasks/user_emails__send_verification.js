/** @typedef {import("./send_email").SendEmailPayload} SendEmailPayload */
/** @typedef {import("graphile-worker").Task} Task */
import { env } from "../../server/assertEnv.ts";

/** @typedef {{
  id: string;
}} UserEmailsSendVerificationPayload */

/** The queued id is the `app_public.user_emails` row to verify; the token lives in `app_private.user_email_secrets`. */
/** @type {Task} */
export default async (inPayload, { addJob, withPgClient }) => {
  /** @type {UserEmailsSendVerificationPayload} */
  const payload = inPayload;
  const {
    rows: [row],
  } = await withPgClient((pgClient) =>
    pgClient.query(
      `select user_emails.email::text as email, secrets.verification_token as token
       from app_public.user_emails
       inner join app_private.user_email_secrets as secrets
         on secrets.user_email_id = user_emails.id
       where user_emails.id = $1
         and user_emails.is_verified is false`,
      [payload.id],
    ),
  );
  if (!row?.token) {
    console.error("Unverified email or token not found; aborting");
    return;
  }
  const { email, token } = row;

  /** @type {SendEmailPayload} */
  const sendEmailPayload = {
    options: {
      to: email,
      subject: "Verify your email address",
    },
    template: "verify_email.mjml",
    variables: {
      token,
      verifyLink: `${env.VITE_ROOT_URL}/verify-email?token=${encodeURIComponent(token)}`,
    },
  };
  await addJob("send_email", sendEmailPayload);
};
