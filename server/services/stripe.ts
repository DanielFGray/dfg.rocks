import {
  Cause,
  Clock,
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Redacted,
  Ref,
  Schema as S,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { sql } from "kysely";
import {
  CheckoutEligibility,
  PayerRelation,
  type MySubscriptionResponse,
  type PlanPrice,
  type SubscriptionPlan,
  type SubscriptionView,
} from "../../shared/api/subscriptions.js";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError } from "../pgErrors.js";
import { notConfigured } from "./stripeErrors.js";

const stripeApi = "https://api.stripe.com/v1";

/**
 * The API version every call sends in `Stripe-Version`, and the version the webhook endpoint in
 * Stripe must use. Pinned so responses and webhook payloads do not follow the account default:
 * the webhook decodes the subscription shape this version defines. Design: docs/design/runtime.md.
 */
export const stripeApiVersion = "2026-10-28.endive";

// Stripe's response carries many more fields; only the hosted page's address is used.
const HostedPage = S.Struct({ url: S.String });

// The fields the pricing page shows, from the Price object for API version 2026-10-28.endive
// (docs.stripe.com/api/prices/object). `unit_amount` is null for a tiered price, which this app does
// not sell, so a null amount is refused rather than shown.
const StripePrice = S.Struct({
  unit_amount: S.NullOr(S.Finite),
  currency: S.String,
  recurring: S.NullOr(S.Struct({ interval: S.String })),
});

// How long the two plan prices are reused before Stripe is asked again. A price change on Stripe
// appears on the pricing page within this window.
const priceCacheTtlMillis = 60 * 60 * 1000;

// The fields the webhook stores, checked against the Subscription object for API version
// 2026-10-28.endive (docs.stripe.com/api/subscriptions/object): `customer` is a string (not
// expanded), `status` and `cancel_at_period_end` are top-level, and `metadata` is a map. The
// Subscription object no longer has current_period_end. Its period end is on each entry of
// `items.data`, which also carries `price.id` (docs.stripe.com/api/subscription_items/object).
// `payer_id` is copied from the Checkout Session's subscription_data.metadata. A subscription
// without it was not created by this app, so the webhook records the event and writes nothing.
export const StripeSubscription = S.Struct({
  id: S.String,
  customer: S.String,
  status: S.String,
  cancel_at_period_end: S.Boolean,
  metadata: S.Struct({ payer_id: S.optionalKey(S.String.pipe(S.check(S.isUUID()))) }),
  items: S.Struct({
    data: S.NonEmptyArray(
      S.Struct({
        price: S.Struct({ id: S.String }),
        current_period_end: S.Finite,
      }),
    ),
  }),
});

/** A Stripe call for a subscription failed for a reason other than the subscription being gone. */
const subscriptionUnavailable = () =>
  new HttpError({ status: 500, message: "Stripe subscription could not be retrieved" });

export const priceVariable = {
  monthly: "STRIPE_PRICE_MONTHLY",
  annual: "STRIPE_PRICE_ANNUAL",
} as const;
const plans = ["monthly", "annual"] as const;

// Each call reads only the settings it uses: the portal needs no price, and one plan's missing
// price does not stop the other plan.
const secretKey = Config.Redacted("STRIPE_SECRET_KEY").pipe(Effect.mapError(notConfigured));
const priceId = (plan: SubscriptionPlan) =>
  Config.NonEmptyString(priceVariable[plan]).pipe(Effect.mapError(notConfigured));
const rootUrl = Config.NonEmptyString("VITE_ROOT_URL").pipe(Effect.mapError(notConfigured));

/**
 * The plan a stored price belongs to, or none when it is neither plan. A deployment without the
 * price settings still reports a subscription, with its plan unnamed, instead of failing the page.
 */
const planOfPrice = Effect.fnUntraced(function* (price: string) {
  const monthly = yield* Config.NonEmptyString(priceVariable.monthly).pipe(Config.option);
  const annual = yield* Config.NonEmptyString(priceVariable.annual).pipe(Config.option);
  if (Option.contains(monthly, price)) return Option.some<SubscriptionPlan>("monthly");
  if (Option.contains(annual, price)) return Option.some<SubscriptionPlan>("annual");
  return Option.none<SubscriptionPlan>();
});

// How long one Stripe price read may take. Without a limit, a slow Stripe holds the pricing page open.
const priceRequestTimeout = Duration.seconds(10);

/** The Checkout and Customer Portal calls. Each one is a Stripe REST call with form-encoded fields. */
export class Stripe extends Context.Service<Stripe>()("dfg-rocks/stripe", {
  make: Effect.gen(function* () {
    // `http` returns every status. `client` turns a non-2xx status into a failure.
    const http = yield* HttpClient.HttpClient;
    const client = http.pipe(HttpClient.filterStatusOk);

    // The plan prices, kept for `priceCacheTtlMillis`. A failed read is not kept, so the next
    // request asks Stripe again.
    const priceCache = yield* Ref.make(
      Option.none<{ readonly plans: ReadonlyArray<PlanPrice>; readonly expiresAt: number }>(),
    );

    const postForHostedPage = Effect.fnUntraced(function* (
      key: Redacted.Redacted,
      path: string,
      fields: ReadonlyArray<readonly [string, string]>,
    ) {
      return yield* HttpClientRequest.post(`${stripeApi}${path}`).pipe(
        HttpClientRequest.bearerToken(key),
        HttpClientRequest.setHeader("Stripe-Version", stripeApiVersion),
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

    const priceOf = Effect.fnUntraced(function* (key: Redacted.Redacted, plan: SubscriptionPlan) {
      const id = yield* priceId(plan);
      const price = yield* HttpClientRequest.get(
        `${stripeApi}/prices/${encodeURIComponent(id)}`,
      ).pipe(
        HttpClientRequest.bearerToken(key),
        HttpClientRequest.setHeader("Stripe-Version", stripeApiVersion),
        client.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(StripePrice)),
        Effect.timeout(priceRequestTimeout),
        Effect.catch((error) =>
          Effect.logWarning("Stripe price request failed", {
            plan,
            error: error._tag,
            message: error.message,
            cause: Cause.pretty(Cause.fail(error)),
          }).pipe(
            Effect.andThen(
              Effect.fail(new HttpError({ status: 502, message: "Stripe did not answer" })),
            ),
          ),
        ),
      );
      if (price.unit_amount === null || price.recurring === null) {
        yield* Effect.logWarning("Stripe price is not a recurring flat amount", { plan });
        return yield* new HttpError({ status: 502, message: "Stripe price is not usable" });
      }
      return {
        plan,
        amount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring.interval,
      } satisfies PlanPrice;
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

    // The reader's payer relation and checkout eligibility, one row from SQL
    // (app_public.payer_relation and checkout_eligibility). A missing row or a value the schema does
    // not name is a broken invariant, so the request dies instead of answering a guess.
    const relationAndEligibility = Effect.fn("relationAndEligibility")(function* () {
      const row = yield* RequestDatabase.use((db) =>
        db.execute(
          db.selectNoFrom(() => [
            sql<string>`app_public.payer_relation()`.as("payer"),
            sql<string>`app_public.checkout_eligibility()`.as("checkout"),
          ]),
        ),
      ).pipe(Effect.head);
      const payer = yield* S.decodeUnknownEffect(PayerRelation)(row.payer);
      const checkout = yield* S.decodeUnknownEffect(CheckoutEligibility)(row.checkout);
      return { payer, checkout };
    }, Effect.orDie);

    /**
     * The reader's own subscription, or the live subscription that covers the reader. A live row
     * sorts first, so a reader whose newest row is canceled still sees a live one. The live flag is
     * computed in SQL. Runs in the caller's visitor transaction.
     */
    const subscriptionView = Effect.fn("subscriptionView")(function* (
      userId: string,
      which: "own" | "covering",
    ) {
      const live = sql<boolean>`app_public.subscription_is_live(status, current_period_end)`;
      const rows = yield* RequestDatabase.use((db) => {
        const query = db
          .selectFrom("app_public.subscriptions")
          .select([
            "status",
            "price_id",
            "current_period_end",
            "cancel_at_period_end",
            live.as("live"),
          ])
          .where("payer_id", which === "own" ? "=" : "<>", userId)
          .orderBy(live, "desc")
          .orderBy("created_at", "desc")
          .limit(1);
        return db.execute(which === "covering" ? query.where(live) : query);
      });
      const row = rows[0];
      if (row === undefined) return Option.none<SubscriptionView>();
      const plan = yield* planOfPrice(row.price_id);
      return Option.some({
        status: row.status,
        plan: Option.getOrNull(plan),
        current_period_end: row.current_period_end,
        cancel_at_period_end: row.cancel_at_period_end,
        live: row.live,
      } satisfies SubscriptionView);
    });

    return {
      /**
       * The monthly and annual prices, as Stripe states them. Refused with 503 while the price settings
       * are missing, and with 502 when Stripe cannot answer.
       */
      planPrices: Effect.fn("planPrices")(function* () {
        const now = yield* Clock.currentTimeMillis;
        const cached = yield* Ref.get(priceCache);
        if (Option.isSome(cached) && cached.value.expiresAt > now) {
          return cached.value.plans;
        }
        const key = yield* secretKey;
        const prices = yield* Effect.forEach(plans, (plan) => priceOf(key, plan));
        yield* Ref.set(
          priceCache,
          Option.some({ plans: prices, expiresAt: now + priceCacheTtlMillis }),
        );
        return prices;
      }),

      /**
       * Who pays for the reader, what the reader may do about it, and the subscriptions that matter
       * to the reader: `own` (the reader's own, which the reader manages) and `covering` (a live
       * subscription of a family's billing contact). Every fact comes from SQL functions read under
       * the caller's row security, so the rules live in the database. Runs in the visitor transaction.
       */
      billingStatus: Effect.fn("billingStatus")(function* (userId: string) {
        const { payer, checkout } = yield* relationAndEligibility();
        const own = yield* subscriptionView(userId, "own");
        const covering = yield* subscriptionView(userId, "covering");
        return {
          payer,
          checkout,
          own: Option.getOrNull(own),
          covering: Option.getOrNull(covering),
        } satisfies MySubscriptionResponse;
      }),

      /**
       * The Stripe customer the caller subscribes through, or none before its first subscription.
       * Refused with 409 when a live subscription already covers the caller, and with 403 when the
       * caller pays through a family's billing contact. Runs in the caller's visitor transaction.
       */
      checkoutCustomer: Effect.fn("checkoutCustomer")(function* (userId: string) {
        const { checkout } = yield* relationAndEligibility();
        yield* Match.value(checkout).pipe(
          Match.when("allowed", () => Effect.void),
          Match.when("covered", () =>
            Effect.fail(
              new HttpError({ status: 409, message: "A subscription already covers you" }),
            ),
          ),
          Match.when("not_billing_contact", () =>
            Effect.fail(
              new HttpError({
                status: 403,
                message: "Your family's billing contact subscribes for you",
              }),
            ),
          ),
          Match.when("no_billing_contact", () =>
            Effect.fail(
              new HttpError({
                status: 403,
                message: "Your family has no billing contact yet, so it cannot subscribe",
              }),
            ),
          ),
          Match.exhaustive,
        );
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
          // Stripe copies this onto every customer.subscription.* event, so the webhook learns the
          // payer from the subscription itself, whatever order the events arrive in.
          ["subscription_data[metadata][payer_id]", userId],
          ["success_url", `${root}/subscribe/success`],
          ["cancel_url", `${root}/pricing`],
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

      /**
       * The subscription as Stripe holds it now: none when Stripe no longer has it (404). A webhook
       * event is a snapshot from when it was sent, so the webhook reads the latest copy. Any other
       * failure is an error, so the caller can refuse the delivery and let Stripe retry it.
       */
      retrieveSubscription: Effect.fn("retrieveSubscription")(function* (id: string) {
        const key = yield* secretKey;
        const response = yield* HttpClientRequest.get(
          `${stripeApi}/subscriptions/${encodeURIComponent(id)}`,
        ).pipe(
          HttpClientRequest.bearerToken(key),
          HttpClientRequest.setHeader("Stripe-Version", stripeApiVersion),
          http.execute,
          Effect.catch(() =>
            Effect.logWarning("Stripe subscription request failed", { subscription: id }).pipe(
              Effect.andThen(Effect.fail(subscriptionUnavailable())),
            ),
          ),
        );
        if (response.status === 404) {
          return Option.none();
        }
        if (response.status < 200 || response.status >= 300) {
          yield* Effect.logWarning("Stripe refused the subscription request", {
            subscription: id,
            status: response.status,
          });
          return yield* subscriptionUnavailable();
        }
        const subscription = yield* HttpClientResponse.schemaBodyJson(StripeSubscription)(
          response,
        ).pipe(
          Effect.catch(() =>
            Effect.logWarning("Stripe subscription body did not match", {
              subscription: id,
            }).pipe(Effect.andThen(Effect.fail(subscriptionUnavailable()))),
          ),
        );
        return Option.some(subscription);
      }),

      /** A Customer Portal session for a customer, and the page to send the browser to. */
      createPortalSession: Effect.fn("createPortalSession")(function* (customer: string) {
        const key = yield* secretKey;
        const root = yield* rootUrl;
        return yield* postForHostedPage(key, "/billing_portal/sessions", [
          ["customer", customer],
          ["return_url", `${root}/settings`],
        ]);
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);

  /**
   * The same service over another HTTP client. E2E runs pass a fake client, so no request leaves
   * the test server; the payer rules and the price settings still run against the database.
   */
  static readonly layerWithHttp = (client: Layer.Layer<HttpClient.HttpClient>) =>
    Layer.effect(this, this.make).pipe(Layer.provide(client));
}
