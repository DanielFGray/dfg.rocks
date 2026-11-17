import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TestClock } from "effect/testing";
import pg from "pg";
import { PgAuthDB } from "../db.js";
import { withAuthContext } from "../requestDatabase.js";
import { Stripe, stripeApiVersion } from "../services/stripe.js";
import { handleApiRequest } from "./apiHandler.js";
import { insertSubscription } from "./subscriptionRow.js";

/** One request the service sent to Stripe: its path, form fields, Authorization and Stripe-Version. */
interface SentRequest {
  path: string;
  form: Record<string, string>;
  authorization: string | undefined;
  stripeVersion: string | undefined;
}

const sent: SentRequest[] = [];
let stripeFails = false;

const checkoutPage = "https://checkout.stripe.com/c/pay/cs_test";
const portalPage = "https://billing.stripe.com/p/session/test";

// Answers the two calls the service makes and records each one. Any other request, or a body that
// is not a form, is recorded and answered 500, so a test that expects a clean call sees the failure.
const fakeStripe = HttpClient.make((request, url) => {
  const body = request.body;
  const form =
    body._tag === "Uint8Array"
      ? Object.fromEntries(new URLSearchParams(new TextDecoder().decode(body.body)))
      : {};
  sent.push({
    path: url.pathname,
    form,
    authorization: request.headers["authorization"],
    stripeVersion: request.headers["stripe-version"],
  });
  const answers: Record<string, string> = {
    "/v1/checkout/sessions": checkoutPage,
    "/v1/billing_portal/sessions": portalPage,
  };
  const page = answers[url.pathname];
  if (!stripeFails && url.pathname.startsWith("/v1/prices/")) {
    const id = url.pathname.slice("/v1/prices/".length);
    const monthly = id === monthlyPrice;
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          id,
          object: "price",
          currency: "usd",
          unit_amount: monthly ? 1500 : 15000,
          recurring: { interval: monthly ? "month" : "year" },
        }),
      ),
    );
  }
  if (stripeFails || page === undefined || body._tag !== "Uint8Array") {
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response("unexpected", { status: 500 })),
    );
  }
  return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ url: page })));
});

const runId = Math.random().toString(36).slice(2, 8);
const root = requiredEnv("VITE_ROOT_URL");
const monthlyPrice = requiredEnv("STRIPE_PRICE_MONTHLY");
const annualPrice = requiredEnv("STRIPE_PRICE_ANNUAL");

const stripeTestLayer = Layer.mergeAll(
  PgAuthDB.layer,
  Stripe.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, fakeStripe))),
);

let ownerPool: pg.Pool;

// Each reader stands for one billing position, and has its own family or subscription, so no test
// depends on rows another test writes. Family A's billing contact (parent) never holds a live
// subscription, so its members (kid, pendingKid) are not covered.
const ids = {
  parent: "", // billing contact of family A, with no live subscription
  kid: "", // member of family A
  pendingKid: "", // member of family A
  stranger: "", // no family, no subscription
  paidParent: "", // billing contact of family B, with a live subscription
  coveredKid: "", // member of family B, covered by paidParent
  orphanParent: "", // parent of family D, which has no billing contact
  ownLive: "", // no family, with a live subscription of their own
};
const sessions = { ...ids };
const usernames = { ...ids };

function owner(text: string, params?: unknown[]) {
  return ownerPool.query(text, params);
}

/** A user who can sign in with the password `${username}123`. */
async function createUser(name: string, role: string): Promise<{ id: string; username: string }> {
  const username = `stripe_${name}_${runId}`;
  const r = await owner(
    `select id from app_private.really_create_user($1::citext, $1, null, true, $2::citext, $3)`,
    [username, `${username}@test.com`, `${username}123`],
  );
  await owner(`update app_public.users set role = $1 where id = $2`, [role, r.rows[0].id]);
  return { id: r.rows[0].id, username };
}

async function sessionFor(userId: string): Promise<string> {
  const r = await owner(`insert into app_private.sessions (user_id) values ($1) returning id`, [
    userId,
  ]);
  return r.rows[0].id;
}

/**
 * Gives a payer a canceled subscription row: enough to name the payer's Stripe customer, without
 * making the payer covered by a live subscription.
 */
const subscribe = (payerId: string, customerId: string) =>
  insertSubscription(owner, { payerId, customerId, status: "canceled" });

/** Each test takes its own customer id, so no test relies on a row another test inserted. */
const customerFor = (label: string) => `cus_${label}_${runId}`;

beforeAll(async () => {
  ownerPool = new pg.Pool({ connectionString: forceIpv4(requiredEnv("DATABASE_URL")) });

  const remember = async (name: keyof typeof ids, role: string) => {
    const user = await createUser(
      name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
      role,
    );
    ids[name] = user.id;
    usernames[name] = user.username;
    sessions[name] = await sessionFor(user.id);
  };
  await remember("parent", "parent");
  await remember("kid", "student");
  await remember("pendingKid", "student");
  await remember("stranger", "student");
  await remember("paidParent", "parent");
  await remember("coveredKid", "student");
  await remember("orphanParent", "parent");
  await remember("ownLive", "student");

  // Family A: the parent is the billing contact; the kid and pendingKid are members.
  await addFamily(`stripe-family-${runId}`, [
    [ids.parent, true, true],
    [ids.kid, false, false],
    [ids.pendingKid, false, false],
  ]);
  // Family B: the paid parent is the billing contact, and holds a live subscription.
  await addFamily(`stripe-paid-${runId}`, [
    [ids.paidParent, true, true],
    [ids.coveredKid, false, false],
  ]);
  await insertSubscription(owner, {
    payerId: ids.paidParent,
    customerId: customerFor("paid_parent"),
  });
  await insertSubscription(owner, { payerId: ids.ownLive, customerId: customerFor("own_live") });
  // Family D: a parent without the billing contact role, so the family has no one who pays.
  await addFamily(`stripe-orphan-${runId}`, [[ids.orphanParent, true, false]]);
}, 120_000);

/** Creates a family with the given members: [user id, is owner, is billing contact]. */
async function addFamily(
  slug: string,
  members: ReadonlyArray<readonly [string, boolean, boolean]>,
) {
  const family = await owner(
    `insert into app_public.families (slug, name) values ($1, 'Stripe Family') returning id`,
    [slug],
  );
  for (const [userId, isOwner, isBillingContact] of members) {
    await owner(
      `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
       values ($1, $2, $3, $4)`,
      [family.rows[0].id, userId, isOwner, isBillingContact],
    );
  }
}

afterAll(async () => {
  await ownerPool?.end();
}, 30_000);

it.layer(stripeTestLayer)("Stripe service", (it) => {
  describe("Checkout", () => {
    it.effect(
      "starts a monthly subscription for a payer with no customer yet, so Stripe asks for one",
      () =>
        Effect.gen(function* () {
          sent.length = 0;
          const stripe = yield* Stripe;
          const customer = yield* stripe
            .checkoutCustomer(ids.stranger)
            .pipe(withAuthContext(sessions.stranger));
          const url = yield* stripe.createCheckoutSession(ids.stranger, "monthly", customer);

          expect(customer).toEqual(Option.none());
          expect(url).toBe(checkoutPage);
          expect(sent).toEqual([
            {
              path: "/v1/checkout/sessions",
              authorization: "Bearer sk_test_placeholder",
              stripeVersion: stripeApiVersion,
              form: {
                mode: "subscription",
                "line_items[0][price]": monthlyPrice,
                "line_items[0][quantity]": "1",
                "automatic_tax[enabled]": "true",
                client_reference_id: ids.stranger,
                "subscription_data[metadata][payer_id]": ids.stranger,
                success_url: `${root}/subscribe/success`,
                cancel_url: `${root}/pricing`,
              },
            },
          ]);
        }),
    );

    it.effect(
      "reuses the payer's Stripe customer and lets Stripe update its address, on the annual plan",
      () =>
        Effect.gen(function* () {
          const customerId = customerFor("checkout_annual");
          yield* Effect.promise(() => subscribe(ids.parent, customerId));
          sent.length = 0;
          const stripe = yield* Stripe;
          const customer = yield* stripe
            .checkoutCustomer(ids.parent)
            .pipe(withAuthContext(sessions.parent));
          yield* stripe.createCheckoutSession(ids.parent, "annual", customer);

          expect(sent).toHaveLength(1);
          expect(sent[0].form).toEqual({
            mode: "subscription",
            "line_items[0][price]": annualPrice,
            "line_items[0][quantity]": "1",
            "automatic_tax[enabled]": "true",
            customer: customerId,
            "customer_update[address]": "auto",
            client_reference_id: ids.parent,
            "subscription_data[metadata][payer_id]": ids.parent,
            success_url: `${root}/subscribe/success`,
            cancel_url: `${root}/pricing`,
          });
        }),
    );

    it.effect("refuses a family member whose billing contact pays, saying so", () =>
      Effect.gen(function* () {
        const stripe = yield* Stripe;
        const error = yield* stripe
          .checkoutCustomer(ids.pendingKid)
          .pipe(withAuthContext(sessions.pendingKid), Effect.flip);
        expect(error).toMatchObject({
          _tag: "HttpError",
          status: 403,
          message: "Your family's billing contact subscribes for you",
        });
      }),
    );

    it.effect("refuses a parent whose family has no billing contact, saying so", () =>
      Effect.gen(function* () {
        const stripe = yield* Stripe;
        const error = yield* stripe
          .checkoutCustomer(ids.orphanParent)
          .pipe(withAuthContext(sessions.orphanParent), Effect.flip);
        expect(error).toMatchObject({
          _tag: "HttpError",
          status: 403,
          message: "Your family has no billing contact yet, so it cannot subscribe",
        });
      }),
    );

    it.effect("refuses a reader a live subscription already covers, with 409", () =>
      Effect.gen(function* () {
        const stripe = yield* Stripe;
        const coveredError = yield* stripe
          .checkoutCustomer(ids.coveredKid)
          .pipe(withAuthContext(sessions.coveredKid), Effect.flip);
        const ownError = yield* stripe
          .checkoutCustomer(ids.ownLive)
          .pipe(withAuthContext(sessions.ownLive), Effect.flip);
        expect(coveredError).toMatchObject({ _tag: "HttpError", status: 409 });
        expect(ownError).toMatchObject({ _tag: "HttpError", status: 409 });
      }),
    );

    it.effect("answers 502 when Stripe fails, and names no Stripe detail", () =>
      Effect.gen(function* () {
        stripeFails = true;
        const stripe = yield* Stripe;
        const error = yield* stripe
          .createCheckoutSession(ids.stranger, "monthly", Option.none())
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                stripeFails = false;
              }),
            ),
            Effect.flip,
          );
        expect(error).toMatchObject({
          _tag: "HttpError",
          status: 502,
          message: "Stripe did not answer",
        });
      }),
    );
  });

  describe("Plan prices", () => {
    // Runs first: a failed read must leave no cached prices for the tests after it.
    it.effect("answers 502 when Stripe cannot price a plan", () =>
      Effect.gen(function* () {
        stripeFails = true;
        const stripe = yield* Stripe;
        const error = yield* stripe.planPrices().pipe(
          Effect.ensuring(
            Effect.sync(() => {
              stripeFails = false;
            }),
          ),
          Effect.flip,
        );
        expect(error).toMatchObject({ _tag: "HttpError", status: 502 });
      }),
    );

    it.effect("answers 503 while the price settings are missing", () =>
      Effect.gen(function* () {
        const stripe = yield* Stripe;
        const error = yield* stripe
          .planPrices()
          .pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))), Effect.flip);
        expect(error).toMatchObject({ _tag: "HttpError", status: 503 });
      }),
    );

    it.effect("reads each price from Stripe once an hour, and again after the hour", () =>
      Effect.gen(function* () {
        sent.length = 0;
        const stripe = yield* Stripe;
        const prices = yield* stripe.planPrices();
        yield* stripe.planPrices();

        expect(prices).toEqual([
          { plan: "monthly", amount: 1500, currency: "usd", interval: "month" },
          { plan: "annual", amount: 15000, currency: "usd", interval: "year" },
        ]);
        expect(sent.map((request) => request.path)).toEqual([
          `/v1/prices/${monthlyPrice}`,
          `/v1/prices/${annualPrice}`,
        ]);

        yield* TestClock.adjust("59 minutes");
        yield* stripe.planPrices();
        expect(sent).toHaveLength(2);

        yield* TestClock.adjust("2 minutes");
        yield* stripe.planPrices();
        expect(sent).toHaveLength(4);
      }),
    );
  });

  describe("Billing status", () => {
    const statusOf = (name: keyof typeof ids) =>
      Effect.gen(function* () {
        const stripe = yield* Stripe;
        return yield* stripe.billingStatus(ids[name]).pipe(withAuthContext(sessions[name]));
      });

    it.effect(
      "shows a billing contact their own live subscription, which already covers them",
      () =>
        Effect.gen(function* () {
          expect(yield* statusOf("paidParent")).toMatchObject({
            payer: "billing_contact",
            checkout: "covered",
            own: { status: "active", live: true },
            covering: null,
          });
        }),
    );

    it.effect(
      "shows a covered family member the billing contact's subscription, which covers them",
      () =>
        Effect.gen(function* () {
          expect(yield* statusOf("coveredKid")).toMatchObject({
            payer: "family_member",
            checkout: "covered",
            own: null,
            covering: { status: "active", live: true },
          });
        }),
    );

    it.effect(
      "shows a family member whose billing contact has no live subscription, and that they may not subscribe",
      () =>
        Effect.gen(function* () {
          expect(yield* statusOf("pendingKid")).toEqual({
            payer: "family_member",
            checkout: "not_billing_contact",
            own: null,
            covering: null,
          });
        }),
    );

    it.effect("shows a family with no billing contact as having none", () =>
      Effect.gen(function* () {
        expect(yield* statusOf("orphanParent")).toEqual({
          payer: "no_billing_contact",
          checkout: "no_billing_contact",
          own: null,
          covering: null,
        });
      }),
    );

    it.effect("shows a reader with no family and no subscription that they may subscribe", () =>
      Effect.gen(function* () {
        expect(yield* statusOf("stranger")).toEqual({
          payer: "self",
          checkout: "allowed",
          own: null,
          covering: null,
        });
      }),
    );

    it.effect("shows a reader's own live subscription as their own, which they manage", () =>
      Effect.gen(function* () {
        expect(yield* statusOf("ownLive")).toMatchObject({
          payer: "self",
          checkout: "covered",
          own: { status: "active", live: true },
          covering: null,
        });
      }),
    );
  });

  describe("Customer Portal", () => {
    it.effect("opens the portal on the caller's own customer", () =>
      Effect.gen(function* () {
        const customerId = customerFor("portal_own");
        yield* Effect.promise(() => subscribe(ids.parent, customerId));
        sent.length = 0;
        const stripe = yield* Stripe;
        const customer = yield* stripe
          .ownCustomer(ids.parent)
          .pipe(withAuthContext(sessions.parent));
        const url = yield* stripe.createPortalSession(customer);

        expect(url).toBe(portalPage);
        expect(sent).toEqual([
          {
            path: "/v1/billing_portal/sessions",
            authorization: "Bearer sk_test_placeholder",
            stripeVersion: stripeApiVersion,
            form: { customer: customerId, return_url: `${root}/settings` },
          },
        ]);
      }),
    );

    it.effect(
      "lets a covered student open the portal on their own subscription, not the family's",
      () =>
        Effect.gen(function* () {
          const customerId = customerFor("portal_covered");
          yield* Effect.promise(() => subscribe(ids.kid, customerId));
          sent.length = 0;
          const stripe = yield* Stripe;
          const customer = yield* stripe.ownCustomer(ids.kid).pipe(withAuthContext(sessions.kid));
          yield* stripe.createPortalSession(customer);

          expect(sent).toHaveLength(1);
          expect(sent[0].form.customer).toBe(customerId);
        }),
    );

    it.effect("answers 404 for a caller with no subscription, without calling Stripe", () =>
      Effect.gen(function* () {
        sent.length = 0;
        const stripe = yield* Stripe;
        const error = yield* stripe
          .ownCustomer(ids.stranger)
          .pipe(withAuthContext(sessions.stranger), Effect.flip);
        expect(error).toMatchObject({ _tag: "HttpError", status: 404 });
        expect(sent).toHaveLength(0);
      }),
    );
  });
});

describe("Subscription API", () => {
  // Signs in through the API, as a browser does, and returns the session cookie.
  async function signIn(username: string): Promise<string> {
    const res = await handleApiRequest(
      new Request(`${root}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "dfg" },
        body: JSON.stringify({ id: username, password: `${username}123` }),
      }),
    );
    const cookie = res.headers.getSetCookie().find((value) => value.startsWith("session="));
    if (res.status !== 200 || cookie === undefined) {
      throw new Error(`sign-in failed for ${username}: ${res.status}`);
    }
    return cookie.split(";")[0];
  }

  const post = (path: string, opts: { cookie?: string; csrf?: boolean; body?: unknown }) =>
    handleApiRequest(
      new Request(`${root}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(opts.csrf === false ? {} : { "X-Requested-With": "dfg" }),
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
        },
        body: JSON.stringify(opts.body ?? {}),
      }),
    );

  it("refuses checkout without a session with 401", async () => {
    const res = await post("/api/subscriptions/checkout", { body: { plan: "monthly" } });
    expect(res.status).toBe(401);
  });

  it("refuses checkout without the CSRF header", async () => {
    const res = await post("/api/subscriptions/checkout", {
      cookie: await signIn(usernames.parent),
      csrf: false,
      body: { plan: "monthly" },
    });
    expect(res.status).toBe(400);
  });

  it("answers 403 to a student whose payer is the billing contact, saying so", async () => {
    const res = await post("/api/subscriptions/checkout", {
      cookie: await signIn(usernames.kid),
      body: { plan: "monthly" },
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("billing contact subscribes");
  });

  it("answers 404 to the portal for a signed-in account with no subscription", async () => {
    const res = await post("/api/subscriptions/portal", {
      cookie: await signIn(usernames.stranger),
    });
    expect(res.status).toBe(404);
  });
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function forceIpv4(urlString: string): string {
  const url = new URL(urlString);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.toString();
}
