/** @typedef {import("./send_email").SendEmailPayload} SendEmailPayload */
/** @typedef {import("graphile-worker").Task} Task */

/** @typedef {{
  email: string;
  code: string;
  inviteLink: string;
}} InvitationPayload */

/** @type {Task} */
export default async (inPayload, { addJob }) => {
  /** @type {InvitationPayload} */
  const payload = inPayload;
  const { email, inviteLink } = payload;

  /** @type {SendEmailPayload} */
  const sendEmailPayload = {
    options: {
      to: email,
      subject: "You've been invited to DFG Portal",
    },
    template: "invitation.mjml",
    variables: {
      inviteLink,
    },
  };
  await addJob("send_email", sendEmailPayload);
};
