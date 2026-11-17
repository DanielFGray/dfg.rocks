import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Csrf, Session } from "./guards.js";
import { Schema as S } from "effect";
import { signedInErrors, TooManyRequestsErrorSchema } from "../httpApiErrors.js";

/** The plans a payer can buy. Each maps to a Stripe price the server reads from configuration. */
export const SubscriptionPlan = S.Literals(["monthly", "annual"]);
export type SubscriptionPlan = typeof SubscriptionPlan.Type;

const CheckoutPayload = S.Struct({ plan: SubscriptionPlan });

/** A Stripe-hosted page the browser is sent to. */
const HostedPageResponse = S.Struct({ url: S.String });

const subscriptionErrors = [...signedInErrors, TooManyRequestsErrorSchema] as const;

export const subscriptionsGroup = HttpApiGroup.make("subscriptions")
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
