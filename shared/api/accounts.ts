import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Csrf, Session } from "./guards.js";
import { Schema as S } from "effect";
import { UserEmail, SuccessResponse } from "../schemas.js";
import { params } from "./fields.js";
import { signedInErrors } from "../httpApiErrors.js";

const ConfirmDeleteAccountPayload = S.Struct({
  token: S.String,
});

const AddEmailPayload = S.Struct({
  email: S.String,
});

const SwitchActiveStudentPayload = S.Struct({
  student_id: S.String,
});

export const accountsGroup = HttpApiGroup.make("accounts")
  .add(
    HttpApiEndpoint.post("requestDeleteAccount", "/request-delete-account", {
      error: signedInErrors,
      success: SuccessResponse,
    }).middleware(Csrf),
  )
  .add(
    HttpApiEndpoint.post("confirmDeleteAccount", "/confirm-delete-account", {
      error: signedInErrors,
      payload: ConfirmDeleteAccountPayload,
      success: SuccessResponse,
    }).middleware(Csrf),
  )
  .add(
    HttpApiEndpoint.get("myEmails", "/me/emails", {
      error: signedInErrors,
      success: S.Array(UserEmail),
    }),
  )
  .add(
    HttpApiEndpoint.post("addMyEmail", "/me/emails", {
      error: signedInErrors,
      payload: AddEmailPayload,
      success: UserEmail,
    }),
  )
  .add(
    HttpApiEndpoint.delete("deleteMyEmail", "/me/emails/:id", {
      error: signedInErrors,
      params: params("id"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("makePrimaryEmail", "/me/emails/:id/make-primary", {
      error: signedInErrors,
      params: params("id"),
      success: UserEmail,
    }),
  )
  .add(
    HttpApiEndpoint.post("resendEmailVerification", "/me/emails/:id/resend-verification", {
      error: signedInErrors,
      params: params("id"),
      success: SuccessResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("switchActiveStudent", "/switch-active-student", {
      error: signedInErrors,
      payload: SwitchActiveStudentPayload,
      success: SuccessResponse,
    }),
  )
  .middleware(Session)
  .prefix("/api");
