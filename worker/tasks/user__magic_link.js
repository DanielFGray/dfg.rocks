/** @typedef {import("../email/sendEmail").QueuedEmail} SendEmailPayload */
/** @typedef {import("graphile-worker").Task} Task */

/** @typedef {{
  id: string;
  email: string;
  token: string;
}} UserMagicLinkPayload */

/** @type {Task} */
export default async (inPayload, { addJob, withPgClient }) => {
  /** @type {UserMagicLinkPayload} */
  const payload = inPayload;
  const { id: userId, email, token } = payload;
  const {
    rows: [user],
  } = await withPgClient((pgClient) =>
    pgClient.query(
      `
        select users.*
        from app_public.users
        where id = $1
      `,
      [userId],
    ),
  );
  if (!user) {
    console.error("User not found; aborting");
    return;
  }

  /** @type {SendEmailPayload} */
  const sendEmailPayload = {
    options: {
      to: email,
      subject: "Your magic login link",
    },
    template: "magic_link.mjml",
    variables: {
      token,
      loginLink: `${process.env.VITE_ROOT_URL}/magic-login?token=${encodeURIComponent(token)}`,
    },
  };
  await addJob("send_email", sendEmailPayload);
};
