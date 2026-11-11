import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Schema as S } from "effect";
import {
  CreateChildPayload,
  CreateChildResponse,
  Family,
  FamilyInviteRole,
  FamilyInvitation,
  SuccessResponse,
} from "../schemas.js";
import { params } from "./fields.js";
import { signedInErrors, adminErrors } from "../httpApiErrors.js";

export const QrInviteResponse = S.Struct({
  invitationId: S.String,
  code: S.String,
  url: S.String,
  expiresAt: S.String,
});

const InviteFamilyPayload = S.Struct({
  username: S.optional(S.String),
  email: S.optional(S.String),
  invited_role: FamilyInviteRole,
});

const QrInvitePayload = S.Struct({
  name: S.optional(S.String),
  slug: S.optional(S.String),
  invited_role: FamilyInviteRole,
});

export const CreateFamilyPayload = S.Struct({
  slug: S.String,
  name: S.String,
});

export const FamilyMember = S.Struct({
  id: S.String,
  username: S.String,
  name: S.NullishOr(S.String),
  role: S.String,
  is_verified: S.Boolean,
  is_owner: S.Boolean,
  is_billing_contact: S.Boolean,
});

export const FamilyInfo = S.Struct({
  id: S.String,
  slug: S.String,
  name: S.String,
  description: S.NullishOr(S.String),
  members: S.Array(FamilyMember),
  pendingInvitations: S.Array(
    S.Struct({
      id: S.String,
      email: S.NullishOr(S.String),
      invited_role: S.String,
      code: S.NullishOr(S.String),
      expires_at: S.NullishOr(S.String),
    }),
  ),
});

const RemoveMemberPayload = S.Struct({
  user_id: S.String,
});

const InviteFamilyMemberPayload = S.Struct({
  email: S.String,
});

const SetChildEmailPayload = S.Struct({
  email: S.String,
});

const SetChildPasswordPayload = S.Struct({
  token: S.String,
  password: S.String,
});

const ChildPasswordResetTokenResponse = S.Struct({
  token: S.String,
});

export const familiesGroup = HttpApiGroup.make("families")
  .add(
    HttpApiEndpoint.post("createChild", "/create-child", {
      error: signedInErrors,
      payload: CreateChildPayload,
      success: CreateChildResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("family", "/family", {
      error: signedInErrors,
      success: FamilyInfo,
    }),
  )
  .add(
    HttpApiEndpoint.post("removeFamilyMember", "/family/remove-member", {
      error: signedInErrors,
      payload: RemoveMemberPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("inviteFamilyMember", "/family/invite", {
      error: signedInErrors,
      payload: InviteFamilyMemberPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("setChildEmail", "/family/child/:childId/email", {
      error: signedInErrors,
      params: params("childId"),
      payload: SetChildEmailPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("requestChildPasswordSet", "/family/child/:childId/request-password-set", {
      error: signedInErrors,
      params: params("childId"),
      success: ChildPasswordResetTokenResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("setChildPassword", "/family/child/:childId/set-password", {
      error: signedInErrors,
      params: params("childId"),
      payload: SetChildPasswordPayload,
      success: SuccessResponse,
    }),
  )
  .prefix("/api");

export const familiesAdminGroup = HttpApiGroup.make("familiesAdmin")
  .add(
    HttpApiEndpoint.get("families", "/families", {
      error: adminErrors,
      success: S.Array(Family),
    }),
  )
  .add(
    HttpApiEndpoint.post("createFamily", "/families", {
      error: adminErrors,
      payload: CreateFamilyPayload,
      success: Family,
    }),
  )
  .add(
    HttpApiEndpoint.post("inviteFamily", "/families/:familyId/invite", {
      error: adminErrors,
      params: params("familyId"),
      payload: InviteFamilyPayload,
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("qrInvite", "/families/:familyId/qr-invite", {
      error: adminErrors,
      params: params("familyId"),
      payload: QrInvitePayload,
      success: QrInviteResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("familyInvitations", "/families/:familyId/invitations", {
      error: adminErrors,
      params: params("familyId"),
      success: S.Array(FamilyInvitation),
    }),
  )
  .prefix("/api/admin");
