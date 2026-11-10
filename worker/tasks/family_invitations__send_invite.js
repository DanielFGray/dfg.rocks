/** @typedef {import("./send_email").SendEmailPayload} SendEmailPayload */
/** @typedef {import("graphile-worker").Task} Task */

/** @typedef {{
  id: string;
}} FamilyInvitationsSendInvitePayload */

/**
 * The queued id is the `app_public.family_invitations` row. An invitation addresses
 * either an email or an existing user; QR invitations have neither and send nothing.
 */
/** @type {Task} */
export default async (inPayload, { addJob, withPgClient }) => {
  /** @type {FamilyInvitationsSendInvitePayload} */
  const payload = inPayload;
  const {
    rows: [invitation],
  } = await withPgClient((pgClient) =>
    pgClient.query(
      `select
         invitations.code,
         coalesce(invitations.email::text, primary_email.email::text) as email
       from app_public.family_invitations as invitations
       left join lateral (
         select email
         from app_public.user_emails
         where user_id = invitations.user_id
         order by is_primary desc, is_verified desc
         limit 1
       ) as primary_email on true
       where invitations.id = $1`,
      [payload.id],
    ),
  );
  if (!invitation?.email) {
    return;
  }

  const query = new URLSearchParams({ id: payload.id });
  if (invitation.code) query.set("code", invitation.code);

  /** @type {SendEmailPayload} */
  const sendEmailPayload = {
    options: {
      to: invitation.email,
      subject: "You've been invited to DFG Portal",
    },
    template: "invitation.mjml",
    variables: {
      inviteLink: `${process.env.VITE_ROOT_URL}/accept-invite?${query}`,
    },
  };
  await addJob("send_email", sendEmailPayload);
};
