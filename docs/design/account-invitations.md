# Account invitations

Staff invite an existing student or parent by name and email. The account exists as soon as the form is sent, so staff can add lessons, rates and bills before the person logs in. The invitation email carries a link that logs the person in once.

## Data

An account invitation is a `app_public.family_invitations` row with `family_id` null and `user_id` set to the new account. It holds `invited_by`, the optional `message`, `created_at` and `expires_at` (30 days). A partial unique index allows one per account. A row with a family keeps its old meaning: an offer to join that family.

When staff pick a family, the account joins it in the same transaction (`app_private.join_family`, with its rules: a family needs a parent billing contact before it takes a student). The invitation row still has no family.

## The secret

The link's secret is the invited address's `app_private.user_email_secrets.verification_token`, set to 32 random bytes. It stays in `app_private`, which no visitor can read, so staff who can read invitation rows cannot read the token. Following the link proves the address. That verifies the address, and an account's first verified address makes the account verified.

**Unclaimed** means an account invitation exists and the account is not verified. It is derived, not stored. An unclaimed account has no password and no linked login, so the token is its only way in.

## Flow

1. `app_public.invite_account(name, email, role, family_id, message)` (staff only) refuses an email that any account holds, verified or not (`EMTKN`). The API looks the holder up first and returns `EmailTaken` with that account, so the form links to it. The function makes a username with `app_private.unique_username`, which also serves OAuth signup. It creates the account, inserts the invitation and then the address. The address trigger sees the invitation and queues no verification email. The invitation insert trigger queues `family_invitations__send_invite`.
2. The worker task (`Invitations.sendInvitation`) sends `account_invitation.mjml` with a link to `/invite?id=…&token=…`. It sends nothing for an account that is already claimed.
3. `/invite` reads the invitation in its loader and uses nothing up, because mail scanners fetch links. The Continue button posts to `POST /api/invitations/:id/claim`, which runs `app_private.claim_account_invitation`. That function clears the token, verifies the address and makes it primary when the account has no primary address, and returns the account. The endpoint sets the session cookie. A wrong, expired or used token gets 400.
4. `app_public.resend_account_invitation(id)` (staff only) works on an unclaimed account. It replaces the token, extends the expiry by 30 days and queues the email again. The old link stops working.

Staff see unclaimed accounts under "Pending invites" on the People page.

Planned next (epic `ep-a247db`): claiming by login link, Google or password reset; the first-login onboarding; parent and student invites with Join/Decline; deleting unclaimed accounts that parents or students made.
