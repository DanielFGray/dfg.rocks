/** @typedef {import("../email/sendEmail").QueuedEmail} SendEmailPayload */
/** @typedef {import("graphile-worker").Task} Task */

/** @typedef {{
  email: string;
}} UserForgotPasswordUnregisteredEmailPayload */

/** @type {Task} */
export default async (inPayload, { addJob }) => {
  /** @type {UserForgotPasswordUnregisteredEmailPayload} */
  const payload = inPayload;
  const { email } = payload;

  /** @type {SendEmailPayload} */
  const sendEmailPayload = {
    options: {
      to: email,
      subject: "Password reset attempt",
    },
    template: "password_reset_unregistered.mjml",
    variables: {
      email,
    },
  };
  await addJob("send_email", sendEmailPayload);
};
