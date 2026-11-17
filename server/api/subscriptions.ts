import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { checkRateLimit } from "../rateLimit.js";
import { Stripe } from "../services/stripe.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";

// Rate-limited endpoints can answer 429, which the signed-in adapter does not allow.
const adaptSubscriptionErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, [400, 401, 403, 404, 409, 429, 500, 502, 503] as const);

export const SubscriptionsApiGroupLive = HttpApiBuilder.group(
  Contract,
  "subscriptions",
  (handlers) =>
    handlers
      .handle(
        "startCheckout",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* checkRateLimit("checkout", request.headers);
          const auth = yield* CurrentSession;
          // The visitor transaction closes before the Stripe call: no HTTP call runs inside one.
          const customer = yield* Stripe.use((stripe) =>
            stripe.checkoutCustomer(auth.user.id).pipe(withAuthContext(auth.session.id)),
          );
          const url = yield* Stripe.use((stripe) =>
            stripe.createCheckoutSession(auth.user.id, payload.plan, customer),
          );
          return { url };
        }, adaptSubscriptionErrors),
      )
      .handle(
        "openPortal",
        Effect.fnUntraced(function* ({ request }) {
          yield* checkRateLimit("billing-portal", request.headers);
          const auth = yield* CurrentSession;
          const customer = yield* Stripe.use((stripe) =>
            stripe.ownCustomer(auth.user.id).pipe(withAuthContext(auth.session.id)),
          );
          const url = yield* Stripe.use((stripe) => stripe.createPortalSession(customer));
          return { url };
        }, adaptSubscriptionErrors),
      ),
);
