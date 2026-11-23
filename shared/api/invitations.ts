import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Schema as S } from "effect";
import { Csrf, Session, Staff } from "./guards.js";
import { FamilyInviteRole, SuccessResponse, User } from "../schemas.js";
import { adminErrors } from "../httpApiErrors.js";
import { publicErrors } from "./public.js";

/**
 * Account invitations: staff create an account for a student or parent, and its email logs
 * them in. Design: docs/design/account-invitations.md.
 */

export const InviteAccountPayload = S.Struct({
  name: S.String.pipe(S.check(S.isNonEmpty())),
  email: S.String.pipe(S.check(S.isNonEmpty())),
  role: FamilyInviteRole,
  family_id: S.optional(S.String),
  message: S.optional(S.String.pipe(S.check(S.isMaxLength(2000)))),
});

const InvitedPerson = S.Struct({
  id: S.String,
  username: S.String,
  name: S.NullOr(S.String),
});

/** An email that any account already holds is not invited: the form links to that account. */
export const InviteAccountResult = S.Union([
  S.TaggedStruct("Invited", { person: InvitedPerson }),
  S.TaggedStruct("EmailTaken", { person: InvitedPerson }),
]);
export type InviteAccountResult = typeof InviteAccountResult.Type;

/** An invited account whose owner has not followed the link yet. */
export const PendingInvitation = S.Struct({
  id: S.String,
  user_id: S.String,
  name: S.NullOr(S.String),
  username: S.String,
  email: S.NullOr(S.String),
  invited_by_name: S.NullOr(S.String),
  created_at: S.DateFromString,
  expires_at: S.NullOr(S.DateFromString),
});
export type PendingInvitation = typeof PendingInvitation.Type;

/** An invitation's id, checked before it reaches a uuid column. */
export const InvitationId = S.String.pipe(S.check(S.isUUID()));

const ClaimPayload = S.Struct({ token: S.String.pipe(S.check(S.isNonEmpty())) });

export const invitationsStaffGroup = HttpApiGroup.make("invitationsStaff")
  .add(
    HttpApiEndpoint.post("inviteAccount", "/invitations", {
      error: adminErrors,
      payload: InviteAccountPayload,
      success: InviteAccountResult,
    }),
  )
  .add(
    HttpApiEndpoint.get("pendingInvitations", "/invitations", {
      error: adminErrors,
      success: S.Array(PendingInvitation),
    }),
  )
  .add(
    HttpApiEndpoint.post("resendInvitation", "/invitations/:id/resend", {
      error: adminErrors,
      params: S.Struct({ id: InvitationId }),
      success: SuccessResponse,
    }),
  )
  .middleware(Csrf)
  .middleware(Staff)
  .middleware(Session)
  .prefix("/api/admin");

/** Following the link: a POST, so a mail scanner that fetches the link does not use it up. */
export const invitationsPublicGroup = HttpApiGroup.make("invitationsPublic")
  .add(
    HttpApiEndpoint.post("claimInvitation", "/invitations/:id/claim", {
      error: publicErrors,
      params: S.Struct({ id: InvitationId }),
      payload: ClaimPayload,
      success: User,
    }).middleware(Csrf),
  )
  .prefix("/api");
