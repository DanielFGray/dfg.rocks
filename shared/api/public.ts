import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Csrf } from "./guards.js";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import { Schema as S } from "effect";
import { FamilyInviteRole, User, SuccessResponse } from "../schemas.js";
import {
  BadGatewayErrorSchema,
  BadRequestErrorSchema,
  ConflictErrorSchema,
  ForbiddenErrorSchema,
  InternalServerErrorSchema,
  NotFoundErrorSchema,
  ServiceUnavailableErrorSchema,
  TooManyRequestsErrorSchema,
} from "../httpApiErrors.js";
import { ContactFormat, ContactInstrument } from "../contactOptions.js";
import {
  FeedbackCategory,
  feedbackPageUrlMaxLength,
  feedbackTextMaxLength,
} from "../feedback.js";
import { params } from "./fields.js";
import { PlansResponse } from "./subscriptions.js";

/** The contact form. `website` is a field people never see; a bot that fills it is refused. */
export const ContactPayload = S.Struct({
  name: S.String.pipe(S.check(S.isNonEmpty())),
  email: S.String.pipe(S.check(S.isNonEmpty())),
  phone: S.optional(S.String),
  instrument: ContactInstrument,
  format: ContactFormat,
  message: S.optional(S.String),
  website: S.optional(S.String),
});

/**
 * The feedback dialog. `page_url` and `app_version` arrive pre-filled by the client;
 * the server logs the user's id from the session, never from the payload.
 * `website` is a field people never see; a bot that fills it is refused.
 */
export const FeedbackPayload = S.Struct({
  message: S.String.pipe(S.check(S.isNonEmpty()), S.check(S.isMaxLength(feedbackTextMaxLength))),
  category: FeedbackCategory,
  contact: S.optional(S.String.pipe(S.check(S.isMaxLength(feedbackTextMaxLength)))),
  page_url: S.String.pipe(
    S.check(S.isNonEmpty()),
    S.check(S.isMaxLength(feedbackPageUrlMaxLength)),
  ),
  app_version: S.String.pipe(S.check(S.isNonEmpty()), S.check(S.isMaxLength(40))),
  website: S.optional(S.String),
});

const TokenPayload = S.Struct({ token: S.String });

const InvitationResponse = S.Struct({
  id: S.String,
  slug: S.String,
  name: S.String,
  description: S.NullishOr(S.String),
  created_at: S.DateFromString,
  email: S.String,
  invited_role: S.optional(FamilyInviteRole),
});

const InvitationUrlParams = S.Struct({
  code: S.optional(S.String),
});

const AcceptInvitationPayload = S.Struct({
  code: S.optional(S.String),
  username: S.String,
  password: S.String,
  name: S.String,
  email: S.optional(S.String),
});

const AppleUserPayload = S.Struct({
  email: S.optional(S.String),
  name: S.optional(
    S.Struct({
      firstName: S.optional(S.String),
      lastName: S.optional(S.String),
    }),
  ),
});

const AppleCallbackPayload = S.Struct({
  error: S.optional(S.String),
  code: S.optional(S.String),
  state: S.optional(S.String),
  user: S.optional(S.fromJsonString(AppleUserPayload)),
}).pipe(HttpApiSchema.asMultipart());

export const publicErrors = [
  BadRequestErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  ConflictErrorSchema,
  TooManyRequestsErrorSchema,
  InternalServerErrorSchema,
  BadGatewayErrorSchema,
  ServiceUnavailableErrorSchema,
] as const;

export const publicGroup = HttpApiGroup.make("public")
  .add(
    HttpApiEndpoint.post("contact", "/contact", {
      error: publicErrors,
      payload: ContactPayload,
      success: SuccessResponse,
    }).middleware(Csrf),
  )
  .add(
    HttpApiEndpoint.post("feedback", "/feedback", {
      error: publicErrors,
      payload: FeedbackPayload,
      success: SuccessResponse,
    }).middleware(Csrf),
  )
  // Prices are public: the pricing page lists them before a reader signs in.
  .add(
    HttpApiEndpoint.get("subscriptionPlans", "/subscriptions/plans", {
      error: publicErrors,
      success: PlansResponse,
    }),
  )
  .add(HttpApiEndpoint.get("oauthGoogle", "/oauth/google", { error: publicErrors }))
  .add(
    HttpApiEndpoint.get("oauthGoogleCallback", "/oauth/google/callback", { error: publicErrors }),
  )
  .add(HttpApiEndpoint.get("oauthApple", "/oauth/apple", { error: publicErrors }))
  .add(
    HttpApiEndpoint.post("oauthAppleCallback", "/oauth/apple/callback", {
      error: publicErrors,
      payload: AppleCallbackPayload,
    }),
  )
  // Stripe's signature covers the raw body, so this endpoint declares no payload and reads the body
  // itself. It has no Csrf middleware: Stripe sends no session or CSRF header.
  .add(HttpApiEndpoint.post("stripeWebhook", "/stripe/webhook", { error: publicErrors }))
  .add(
    HttpApiEndpoint.post("verifyEmail", "/verify-email", {
      error: publicErrors,
      payload: TokenPayload,
      success: SuccessResponse,
    }).middleware(Csrf),
  )
  .add(
    HttpApiEndpoint.get("invitation", "/invitation/:id", {
      error: publicErrors,
      params: params("id"),
      query: InvitationUrlParams,
      success: InvitationResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("acceptInvitation", "/invitation/:id/accept", {
      error: publicErrors,
      params: params("id"),
      payload: AcceptInvitationPayload,
      success: User,
    }).middleware(Csrf),
  )
  .prefix("/api");
