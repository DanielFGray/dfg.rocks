#!/usr/bin/env bun
/**
 * Makes Stripe hold the plans and promotion codes declared in shared/pricing.ts.
 *
 * Usage: bun --env-file=.env scripts/stripe-sync-prices.ts [--dry-run]
 *
 * Reads STRIPE_SECRET_KEY, a test or live key. Each declared price is found by its lookup key: an
 * active price with the same amount, currency, interval and tax behavior is kept; a different one is
 * replaced (the new price takes the lookup key, then the old one is archived). Stripe keeps a
 * subscriber on the price they signed up at, so a replaced price reaches new subscribers only.
 */
import { BunRuntime } from "@effect/platform-bun";
import { Config, Effect, Schema as S } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import {
  planPrices,
  productId,
  productName,
  promotionCodes,
  type PromotionCodeDeclaration,
} from "../shared/pricing.js";
import { stripeApi, stripeApiVersion } from "../server/services/stripe.js";
import {
  planPriceActions,
  planPromotionActions,
  type PriceAction,
  type StripePriceState,
} from "./stripeSyncPlan.js";

// The Stripe objects the sync reads, for API version stripeApiVersion. Fields the sync does not use
// are left out.
const ListedPrice = S.Struct({
  id: S.String,
  lookup_key: S.NullOr(S.String),
  active: S.Boolean,
  unit_amount: S.NullOr(S.Finite),
  currency: S.String,
  recurring: S.NullOr(S.Struct({ interval: S.String })),
  tax_behavior: S.String,
});
const PriceList = S.Struct({ data: S.Array(ListedPrice) });
const PromotionCodeList = S.Struct({ data: S.Array(S.Struct({ code: S.String })) });
const Created = S.Struct({ id: S.String });

type Form = ReadonlyArray<readonly [string, string]>;

/** One authenticated Stripe call; a non-2xx answer fails with the HTTP client's error. */
const send = <A, I>(request: HttpClientRequest.HttpClientRequest, schema: S.Codec<A, I>) =>
  Effect.gen(function* () {
    const key = yield* Config.Redacted("STRIPE_SECRET_KEY");
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    return yield* request.pipe(
      HttpClientRequest.bearerToken(key),
      HttpClientRequest.setHeader("Stripe-Version", stripeApiVersion),
      client.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
    );
  });

const post = (path: string, form: Form) =>
  send(
    HttpClientRequest.post(`${stripeApi}${path}`).pipe(HttpClientRequest.bodyUrlParams(form)),
    Created,
  );

const toState = (price: typeof ListedPrice.Type): StripePriceState => ({
  id: price.id,
  lookupKey: price.lookup_key,
  active: price.active,
  amountCents: price.unit_amount,
  currency: price.currency,
  interval: price.recurring?.interval ?? null,
  taxBehavior: price.tax_behavior,
});

const sync = Effect.fnUntraced(function* (dryRun: boolean) {
  const declaredPrices = Object.values(planPrices);
  const lookupQuery = new URLSearchParams({ active: "true" });
  for (const price of declaredPrices) lookupQuery.append("lookup_keys[]", price.lookupKey);
  const listed = yield* send(
    HttpClientRequest.get(`${stripeApi}/prices?${lookupQuery}`),
    PriceList,
  );
  const priceActions = planPriceActions(declaredPrices, listed.data.map(toState));

  // A 404 means the product is absent and is created; any other failure is an error.
  const key = yield* Config.Redacted("STRIPE_SECRET_KEY");
  const client = yield* HttpClient.HttpClient;
  const product = yield* client.execute(
    HttpClientRequest.get(`${stripeApi}/products/${productId}`).pipe(
      HttpClientRequest.bearerToken(key),
      HttpClientRequest.setHeader("Stripe-Version", stripeApiVersion),
    ),
  );
  if (product.status === 404) {
    yield* Effect.log(`product ${productId}: create`);
    if (!dryRun) {
      yield* post("/products", [
        ["id", productId],
        ["name", productName],
      ]);
    }
  } else {
    yield* HttpClientResponse.filterStatusOk(product);
  }

  for (const action of priceActions) {
    yield* applyPrice(action, dryRun);
  }

  for (const declaration of promotionCodes) {
    const found = yield* send(
      HttpClientRequest.get(
        `${stripeApi}/promotion_codes?${new URLSearchParams([
          ["active", "true"],
          ["code", declaration.code],
        ])}`,
      ),
      PromotionCodeList,
    );
    const [action] = planPromotionActions(
      [declaration],
      found.data.map((code) => code.code),
    );
    if (action?._tag === "create") {
      yield* Effect.log(`promotion code ${declaration.code}: create`);
      if (!dryRun) yield* createPromotionCode(declaration);
    } else {
      yield* Effect.log(`promotion code ${declaration.code}: keep`);
    }
  }
});

const applyPrice = Effect.fnUntraced(function* (action: PriceAction, dryRun: boolean) {
  const { declaration } = action;
  if (action._tag === "keep") {
    yield* Effect.log(`price ${declaration.lookupKey}: keep ${action.priceId}`);
    return;
  }
  const replacing = action._tag === "replace";
  yield* Effect.log(
    replacing
      ? `price ${declaration.lookupKey}: replace ${action.archivedPriceId} (archive it)`
      : `price ${declaration.lookupKey}: create`,
  );
  if (dryRun) return;
  // transfer_lookup_key moves the key off the old price in the same request, so the old price can be
  // archived afterwards without the key colliding with the new one.
  const created = yield* post("/prices", [
    ["product", productId],
    ["currency", declaration.currency],
    ["unit_amount", String(declaration.amountCents)],
    ["lookup_key", declaration.lookupKey],
    ["metadata[plan]", declaration.plan],
    ["tax_behavior", declaration.taxBehavior],
    ...(declaration.interval === null
      ? []
      : [["recurring[interval]", declaration.interval] as const]),
    ...(replacing ? [["transfer_lookup_key", "true"] as const] : []),
  ]);
  yield* Effect.log(`price ${declaration.lookupKey}: created ${created.id}`);
  if (replacing) {
    yield* post(`/prices/${action.archivedPriceId}`, [["active", "false"]]);
    yield* Effect.log(`price ${declaration.lookupKey}: archived ${action.archivedPriceId}`);
  }
});

// The promotion code points at a coupon named after it; the coupon holds the discount.
const createPromotionCode = Effect.fnUntraced(function* (declaration: PromotionCodeDeclaration) {
  const couponId = `promo_${declaration.code.toLowerCase()}`;
  const off =
    declaration.off.kind === "percent"
      ? [["percent_off", String(declaration.off.percent)] as const]
      : [
          ["amount_off", String(declaration.off.amountCents)] as const,
          ["currency", declaration.off.currency] as const,
        ];
  const duration =
    declaration.duration.kind === "repeating"
      ? [
          ["duration", "repeating"] as const,
          ["duration_in_months", String(declaration.duration.months)] as const,
        ]
      : [["duration", declaration.duration.kind] as const];
  yield* post("/coupons", [["id", couponId] as const, ...off, ...duration]);
  yield* post("/promotion_codes", [
    ["promotion[type]", "coupon"],
    ["promotion[coupon]", couponId],
    ["code", declaration.code],
    ...(declaration.maxRedemptions === undefined
      ? []
      : [["max_redemptions", String(declaration.maxRedemptions)] as const]),
  ]);
  yield* Effect.log(`promotion code ${declaration.code}: created`);
});

BunRuntime.runMain(
  sync(process.argv.includes("--dry-run")).pipe(Effect.provide(FetchHttpClient.layer)),
);
