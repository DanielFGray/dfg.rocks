/** @typedef {import("./send_email").SendEmailPayload} SendEmailPayload */
/** @typedef {import("graphile-worker").Task} Task */

/** @typedef {{
  id: string;
  email: string;
  token: string;
}} UserVerifyEmailPayload */

/** @type {Task} */
export default async (inPayload, { addJob, withPgClient }) => {
  /** @type {UserVerifyEmailPayload} */
  const payload = inPayload;
  const { id: userId, email, token } = payload;
  const {
    rows: [user],
  } = await withPgClient((pgClient) =>
    pgClient.query(
      `select users.* from app_public.users where id = $1`,
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
      subject: "Verify your email address",
    },
    template: "verify_email.mjml",
    variables: {
      token,
      verifyLink: `${process.env.VITE_ROOT_URL}/verify-email?token=${encodeURIComponent(token)}`,
    },
  };
  await addJob("send_email", sendEmailPayload);
};
