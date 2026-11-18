import { Effect, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { planPrices } from "../../shared/pricing.js";

/**
 * Stands in for Stripe in E2E runs, which start with NODE_ENV=test. It answers the calls the app
 * makes with the shapes Stripe returns, and sends no request off the test server. Checkout answers
 * with the success URL it was given, and the portal with its return URL marked `portal=opened`, so a
 * browser test can see which page the app asked for and that the app followed it.
 */

// The sold plans' prices, from shared/pricing.ts, under the ids the testing API's subscriptions use.
const prices = Object.values(planPrices).map((price) => ({
  id: `price_e2e_${price.plan}`,
  plan: price.plan,
  lookupKey: price.lookupKey,
  interval: price.interval,
  unitAmount: price.amountCents,
  currency: price.currency,
}));

const formFields = (request: HttpClientRequest.HttpClientRequest) =>
  request.body._tag === "Uint8Array"
    ? new URLSearchParams(new TextDecoder().decode(request.body.body))
    : new URLSearchParams();

export const stripeFakeHttp = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request, url) => {
    const json = (status: number, body: unknown) =>
      HttpClientResponse.fromWeb(request, Response.json(body, { status }));

    if (request.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const successUrl = formFields(request).get("success_url");
      return Effect.succeed(
        successUrl === null
          ? json(400, { error: { message: "success_url is required" } })
          : json(200, { url: successUrl }),
      );
    }
    if (request.method === "POST" && url.pathname === "/v1/billing_portal/sessions") {
      const returnUrl = formFields(request).get("return_url");
      if (returnUrl === null) {
        return Effect.succeed(json(400, { error: { message: "return_url is required" } }));
      }
      const opened = new URL(returnUrl);
      opened.searchParams.set("portal", "opened");
      return Effect.succeed(json(200, { url: opened.toString() }));
    }
    if (request.method === "GET" && url.pathname === "/v1/prices") {
      const lookupKeys = url.searchParams.getAll("lookup_keys[]");
      const data = prices
        .filter((price) => lookupKeys.includes(price.lookupKey))
        .map((price) => ({
          id: price.id,
          object: "price",
          active: true,
          lookup_key: price.lookupKey,
          metadata: { plan: price.plan },
          currency: price.currency,
          unit_amount: price.unitAmount,
          recurring:
            price.interval === null ? null : { interval: price.interval, interval_count: 1 },
        }));
      return Effect.succeed(json(200, { object: "list", data, has_more: false }));
    }
    return Effect.succeed(
      json(404, { error: { message: `Not faked: ${request.method} ${url.pathname}` } }),
    );
  }),
);
