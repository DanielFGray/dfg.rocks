import { afterAll, beforeAll, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import pg from "pg";
import { PgAuthDB } from "../db.js";
import { withAuthContext } from "../requestDatabase.js";
import { Stripe } from "../services/stripe.js";
import { handleApiRequest } from "./apiHandler.js";
import { insertSubscription } from "./subscriptionRow.js";

/** One request the service sent to Stripe: its path, form fields and Authorization header. */
interface SentRequest {
  path: string;
  form: Record<string, string>;
  authorization: string | undefined;
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
  });
  const answers: Record<string, string> = {
    "/v1/checkout/sessions": checkoutPage,
    "/v1/billing_portal/sessions": portalPage,
  };
  const page = answers[url.pathname];
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
const ids = { parent: "", kid: "", stranger: "" };
const sessions = { parent: "", kid: "", stranger: "" };
const usernames = { parent: "", kid: "", stranger: "" };

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

/** Gives a payer one subscription row, which is where the service finds the payer's customer. */
const subscribe = (payerId: string, customerId: string) =>
  insertSubscription((text, params) => owner(text, params), { payerId, customerId });

/** Each test takes its own customer id, so no test relies on a row another test inserted. */
const customerFor = (label: string) => `cus_${label}_${runId}`;

beforeAll(async () => {
  ownerPool = new pg.Pool({ connectionString: forceIpv4(requiredEnv("DATABASE_URL")) });

  const parent = await createUser("parent", "parent");
  const kid = await createUser("kid", "student");
  const stranger = await createUser("stranger", "student");
  ids.parent = parent.id;
  ids.kid = kid.id;
  ids.stranger = stranger.id;
  usernames.parent = parent.username;
  usernames.kid = kid.username;
  usernames.stranger = stranger.username;

  // The parent is the billing contact of one family; the kid is a member of it.
  const family = await owner(
    `insert into app_public.families (slug, name) values ($1, 'Stripe Family') returning id`,
    [`stripe-family-${runId}`],
  );
  await owner(
    `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
     values ($1, $2, true, true), ($1, $3, false, false)`,
    [family.rows[0].id, ids.parent, ids.kid],
  );

  sessions.parent = await sessionFor(ids.parent);
  sessions.kid = await sessionFor(ids.kid);
  sessions.stranger = await sessionFor(ids.stranger);
}, 120_000);

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
              form: {
                mode: "subscription",
                "line_items[0][price]": monthlyPrice,
                "line_items[0][quantity]": "1",
                "automatic_tax[enabled]": "true",
                client_reference_id: ids.stranger,
                success_url: `${root}/family`,
                cancel_url: `${root}/family`,
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
            success_url: `${root}/family`,
            cancel_url: `${root}/family`,
          });
        }),
    );

    it.effect("refuses a family member whose billing contact subscribes", () =>
      Effect.gen(function* () {
        const stripe = yield* Stripe;
        const error = yield* stripe
          .checkoutCustomer(ids.kid)
          .pipe(withAuthContext(sessions.kid), Effect.flip);
        expect(error).toMatchObject({ _tag: "HttpError", status: 403 });
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
            form: { customer: customerId, return_url: `${root}/family` },
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
