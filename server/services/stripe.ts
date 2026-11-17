import { Config, Context, Effect, Layer, Option, Redacted, Schema as S } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type { SubscriptionPlan } from "../../shared/api/subscriptions.js";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError } from "../pgErrors.js";

const stripeApi = "https://api.stripe.com/v1";

// Stripe's response carries many more fields; only the hosted page's address is used.
const HostedPage = S.Struct({ url: S.String });

const priceVariable = { monthly: "STRIPE_PRICE_MONTHLY", annual: "STRIPE_PRICE_ANNUAL" } as const;

/** A missing setting answers 503 for the subscription endpoints. The server still boots without it. */
const notConfigured = () =>
  new HttpError({ status: 503, message: "Subscriptions are not configured" });

// Each call reads only the settings it uses: the portal needs no price, and one plan's missing
// price does not stop the other plan.
const secretKey = Config.Redacted("STRIPE_SECRET_KEY").pipe(Effect.mapError(notConfigured));
const priceId = (plan: SubscriptionPlan) =>
  Config.NonEmptyString(priceVariable[plan]).pipe(Effect.mapError(notConfigured));
const rootUrl = Config.NonEmptyString("VITE_ROOT_URL").pipe(Effect.mapError(notConfigured));

/** The Checkout and Customer Portal calls. Each one is a Stripe REST call with form-encoded fields. */
export class Stripe extends Context.Service<Stripe>()("dfg-rocks/stripe", {
  make: Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

    const postForHostedPage = Effect.fnUntraced(function* (
      key: Redacted.Redacted,
      path: string,
      fields: ReadonlyArray<readonly [string, string]>,
    ) {
      return yield* HttpClientRequest.post(`${stripeApi}${path}`).pipe(
        HttpClientRequest.bearerToken(key),
        HttpClientRequest.bodyUrlParams(fields),
        client.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(HostedPage)),
        Effect.map((page) => page.url),
        Effect.catch((error) =>
          Effect.logWarning("Stripe request failed", { path, error: error.message }).pipe(
            Effect.andThen(
              Effect.fail(new HttpError({ status: 502, message: "Stripe did not answer" })),
            ),
          ),
        ),
      );
    });

    /**
     * The Stripe customer behind the user's own subscriptions, the newest first. Runs in the caller's
     * visitor transaction, so RLS shows the caller only its own rows.
     */
    const customerOf = Effect.fn("customerOf")(function* (userId: string) {
      const rows = yield* RequestDatabase.use((db) =>
        db.execute(
          db
            .selectFrom("app_public.subscriptions")
            .select("stripe_customer_id")
            .where("payer_id", "=", userId)
            .orderBy("created_at", "desc")
            .limit(1),
        ),
      );
      return Option.fromNullishOr(rows[0]?.stripe_customer_id);
    });

    return {
      /**
       * The Stripe customer the caller pays through, or none before its first subscription. Only a
       * payer may subscribe: a student whose family's billing contact pays is refused, because the
       * contact's subscription covers them. Runs in the caller's visitor transaction.
       */
      checkoutCustomer: Effect.fn("checkoutCustomer")(function* (userId: string) {
        const payers = yield* RequestDatabase.use((db) =>
          db.execute(
            db
              .selectFrom("app_public.student_payers")
              .select("payer_id")
              .where("student_id", "=", userId),
          ),
        );
        const payer = payers[0];
        if (payer === undefined) {
          return yield* new HttpError({ status: 404, message: "Account not found" });
        }
        if (payer.payer_id === null) {
          return yield* new HttpError({
            status: 403,
            message: "Your family has no billing contact yet, so it cannot subscribe",
          });
        }
        if (payer.payer_id !== userId) {
          return yield* new HttpError({
            status: 403,
            message: "Your family's billing contact subscribes for you",
          });
        }
        return yield* customerOf(userId);
      }),

      /**
       * A Checkout Session that starts a subscription for the caller, and the page to send the
       * browser to. Call it outside the visitor transaction: it makes an HTTP request.
       */
      createCheckoutSession: Effect.fn("createCheckoutSession")(function* (
        userId: string,
        plan: SubscriptionPlan,
        customer: Option.Option<string>,
      ) {
        const key = yield* secretKey;
        const price = yield* priceId(plan);
        const root = yield* rootUrl;
        // customer_update is valid only with a customer. Without one, Stripe creates the customer
        // and asks for the email and address during Checkout.
        const customerFields = Option.match(customer, {
          onNone: (): ReadonlyArray<readonly [string, string]> => [],
          onSome: (id): ReadonlyArray<readonly [string, string]> => [
            ["customer", id],
            ["customer_update[address]", "auto"],
          ],
        });
        return yield* postForHostedPage(key, "/checkout/sessions", [
          ["mode", "subscription"],
          ["line_items[0][price]", price],
          ["line_items[0][quantity]", "1"],
          ["automatic_tax[enabled]", "true"],
          ["client_reference_id", userId],
          ["success_url", `${root}/family`],
          ["cancel_url", `${root}/family`],
          ...customerFields,
        ]);
      }),

      /**
       * The Stripe customer of the caller's own subscription. A student who joined a paying family
       * still manages a subscription they bought before, so the lookup is by the caller, not by
       * the payer. Refuses with 404 when the caller has none.
       */
      ownCustomer: Effect.fn("ownCustomer")(function* (userId: string) {
        const customer = yield* customerOf(userId);
        return yield* Effect.fromOption(customer).pipe(
          Effect.mapError(
            () => new HttpError({ status: 404, message: "You have no subscription to manage" }),
          ),
        );
      }),

      /** A Customer Portal session for a customer, and the page to send the browser to. */
      createPortalSession: Effect.fn("createPortalSession")(function* (customer: string) {
        const key = yield* secretKey;
        const root = yield* rootUrl;
        return yield* postForHostedPage(key, "/billing_portal/sessions", [
          ["customer", customer],
          ["return_url", `${root}/family`],
        ]);
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
