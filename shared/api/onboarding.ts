/**
 * Onboarding: what a new student or parent sees once, at first login. The state names what
 * the steps need to show; finish saves every answer in one transaction and marks the account
 * onboarded. Design: docs/design/account-invitations.md.
 */
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Schema as S } from "effect";
import { Csrf, Session } from "./guards.js";
import { SuccessResponse, UserRole } from "../schemas.js";
import { StudentProfile } from "../studentProfile.js";
import { signedInErrors } from "../httpApiErrors.js";

/** The rule app_public.username checks. */
export const Username = S.String.pipe(
  S.check(S.isMinLength(2)),
  S.check(S.isMaxLength(64)),
  S.check(S.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]+$/)),
);

export const NewPassword = S.String.pipe(S.check(S.isMinLength(8)), S.check(S.isMaxLength(200)));

export const OnboardingState = S.Struct({
  name: S.String,
  username: S.String,
  role: UserRole,
  hasPassword: S.Boolean,
  /** The staff invitation that made the account, when one did. */
  invitation: S.NullOr(S.Struct({ inviterName: S.NullOr(S.String), message: S.NullOr(S.String) })),
  profile: StudentProfile,
});
export type OnboardingState = typeof OnboardingState.Type;

export const FinishOnboardingPayload = S.Struct({
  name: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200))),
  username: Username,
  password: S.optional(NewPassword),
  /** A student's answers. A parent gives the children's answers when adding each child. */
  profile: S.optional(StudentProfile),
});
export type FinishOnboardingPayload = typeof FinishOnboardingPayload.Type;

export const onboardingGroup = HttpApiGroup.make("onboarding")
  .add(
    HttpApiEndpoint.get("onboardingState", "/onboarding", {
      error: signedInErrors,
      success: OnboardingState,
    }),
  )
  .add(
    HttpApiEndpoint.post("finishOnboarding", "/onboarding/finish", {
      error: signedInErrors,
      payload: FinishOnboardingPayload,
      success: SuccessResponse,
    }).middleware(Csrf),
  )
  .middleware(Session)
  .prefix("/api");
