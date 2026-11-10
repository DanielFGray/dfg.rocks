/** @typedef {import("../email/sendEmail").QueuedEmail} SendEmailPayload */
/** @typedef {import("graphile-worker").Task} Task */

/** @typedef {{
  email: string;
  token: string;
}} UserSendDeleteAccountEmailPayload */

/** @type {Task} */
export default async (inPayload, { addJob }) => {
  /** @type {UserSendDeleteAccountEmailPayload} */
  const payload = inPayload;
  const { email, token } = payload;

  /** @type {SendEmailPayload} */
  const sendEmailPayload = {
    options: {
      to: email,
      subject: "Confirm account deletion",
    },
    template: "delete_account.mjml",
    variables: {
      token,
      deleteLink: `${process.env.VITE_ROOT_URL}/confirm-delete-account?token=${encodeURIComponent(token)}`,
    },
  };
  await addJob("send_email", sendEmailPayload);
};
