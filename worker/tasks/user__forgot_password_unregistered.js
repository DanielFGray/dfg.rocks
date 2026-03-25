/** @typedef {import("./send_email").SendEmailPayload} SendEmailPayload */
/** @typedef {import("graphile-worker").Task} Task */

/** @typedef {{
  email: string;
}} UserForgotPasswordUnregisteredPayload */

/** @type {Task} */
export default async (inPayload, { addJob }) => {
  /** @type {UserForgotPasswordUnregisteredPayload} */
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
