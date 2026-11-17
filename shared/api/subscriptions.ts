import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Csrf, Session } from "./guards.js";
import { Schema as S } from "effect";
import { signedInErrors, TooManyRequestsErrorSchema } from "../httpApiErrors.js";

/** The plans a payer can buy. Each maps to a Stripe price the server reads from configuration. */
export const SubscriptionPlan = S.Literals(["monthly", "annual"]);
export type SubscriptionPlan = typeof SubscriptionPlan.Type;

/** One plan's price as Stripe states it: `amount` in the currency's smallest unit, billed every `interval`. */
export const PlanPrice = S.Struct({
  plan: SubscriptionPlan,
  amount: S.Finite,
  currency: S.String,
  interval: S.String,
});
export type PlanPrice = typeof PlanPrice.Type;

export const PlansResponse = S.Struct({ plans: S.Array(PlanPrice) });

/**
 * Who pays for the reader, from app_public.payer_relation: `self` (no family), `billing_contact`
 * (the reader pays for the family), `family_member` (the family's billing contact pays),
 * `no_billing_contact` (the family has none yet).
 */
export const PayerRelation = S.Literals([
  "self",
  "billing_contact",
  "family_member",
  "no_billing_contact",
]);
export type PayerRelation = typeof PayerRelation.Type;

/**
 * Whether the reader may start a subscription, from app_public.checkout_eligibility: `allowed`,
 * `covered` (a live subscription already reaches the reader), `not_billing_contact` (a family member
 * whose family's billing contact pays), `no_billing_contact` (the family has none yet).
 */
export const CheckoutEligibility = S.Literals([
  "allowed",
  "covered",
  "not_billing_contact",
  "no_billing_contact",
]);
export type CheckoutEligibility = typeof CheckoutEligibility.Type;

/**
 * A subscription as the reader may see it. `plan` is null when the price is not one of the two
 * plans. `live` is computed in the database: a paid status whose period has not ended.
 */
export const SubscriptionView = S.Struct({
  status: S.String,
  plan: S.NullOr(SubscriptionPlan),
  current_period_end: S.DateFromString,
  cancel_at_period_end: S.Boolean,
  live: S.Boolean,
});
export type SubscriptionView = typeof SubscriptionView.Type;

/**
 * The reader's billing position. `own` is the reader's own subscription, which the reader manages in
 * the Customer Portal. `covering` is a live subscription that a family's billing contact holds for the
 * reader, which the contact manages. Either is null when there is none.
 */
export const MySubscriptionResponse = S.Struct({
  payer: PayerRelation,
  checkout: CheckoutEligibility,
  own: S.NullOr(SubscriptionView),
  covering: S.NullOr(SubscriptionView),
});
export type MySubscriptionResponse = typeof MySubscriptionResponse.Type;

const CheckoutPayload = S.Struct({ plan: SubscriptionPlan });

/** A Stripe-hosted page the browser is sent to. */
const HostedPageResponse = S.Struct({ url: S.String });

const subscriptionErrors = [...signedInErrors, TooManyRequestsErrorSchema] as const;

export const subscriptionsGroup = HttpApiGroup.make("subscriptions")
  .add(
    HttpApiEndpoint.get("mySubscription", "/subscriptions/me", {
      error: subscriptionErrors,
      success: MySubscriptionResponse,
    }),
  )
  .add(
    HttpApiEndpoint.post("startCheckout", "/subscriptions/checkout", {
      error: subscriptionErrors,
      payload: CheckoutPayload,
      success: HostedPageResponse,
    }).middleware(Csrf),
  )
  .add(
    HttpApiEndpoint.post("openPortal", "/subscriptions/portal", {
      error: subscriptionErrors,
      success: HostedPageResponse,
    }).middleware(Csrf),
  )
  .middleware(Session)
  .prefix("/api");
