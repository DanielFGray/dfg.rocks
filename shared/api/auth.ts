import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Csrf } from "./guards.js";
import { Schema as S } from "effect";
import { User, SuccessResponse } from "../schemas.js";
import {
  BadRequestErrorSchema,
  ConflictErrorSchema,
  InternalServerErrorSchema,
  LockedErrorSchema,
  NotFoundErrorSchema,
  TooManyRequestsErrorSchema,
  UnauthorizedErrorSchema,
} from "../httpApiErrors.js";

const LoginPayload = S.Struct({
  id: S.String,
  password: S.String,
});

const MagicLinkPayload = S.Struct({ email: S.String });

const VerifyMagicLinkPayload = S.Struct({ token: S.String });

const ResetPasswordPayload = S.Struct({
  token: S.String,
  password: S.String,
});

export const MeResponse = S.Struct({
  user: S.NullOr(User),
  isParent: S.Boolean,
  familyStudents: S.Array(User),
  activeStudentId: S.NullishOr(S.String),
  activeStudent: S.NullishOr(
    S.Struct({
      id: S.String,
      username: S.String,
      name: S.String,
    }),
  ),
});

export type MeResponse = S.Schema.Type<typeof MeResponse>;

const authErrors = [
  BadRequestErrorSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ConflictErrorSchema,
  LockedErrorSchema,
  TooManyRequestsErrorSchema,
  InternalServerErrorSchema,
] as const;

export const authGroup = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("login", "/login", {
      error: authErrors,
      payload: LoginPayload,
      success: User,
    }).middleware(Csrf),
  )
  .add(
    HttpApiEndpoint.post("magicLink", "/magic-link", {
      error: authErrors,
      payload: MagicLinkPayload,
      success: SuccessResponse,
    }).middleware(Csrf),
  )
  .add(
    HttpApiEndpoint.post("verifyMagicLink", "/magic-link/verify", {
      error: authErrors,
      payload: VerifyMagicLinkPayload,
      success: User,
    }).middleware(Csrf),
  )
  .add(
    HttpApiEndpoint.post("logout", "/logout", {
      error: authErrors,
      success: SuccessResponse,
    }).middleware(Csrf),
  )
  .add(
    HttpApiEndpoint.post("forgotPassword", "/forgot-password", {
      error: authErrors,
      payload: MagicLinkPayload,
      success: SuccessResponse,
    }).middleware(Csrf),
  )
  .add(
    HttpApiEndpoint.post("resetPassword", "/reset-password", {
      error: authErrors,
      payload: ResetPasswordPayload,
      success: SuccessResponse,
    }).middleware(Csrf),
  )
  .add(HttpApiEndpoint.get("me", "/me", { error: authErrors, success: MeResponse }))
  .add(
    HttpApiEndpoint.post("resendVerification", "/resend-verification", {
      error: authErrors,
      success: SuccessResponse,
    }).middleware(Csrf),
  )
  .prefix("/api");
