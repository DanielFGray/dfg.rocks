import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { stripeApiVersion } from "../services/stripe.js";
import { handleApiRequest } from "./apiHandler.js";

const runId = Math.random().toString(36).slice(2, 8);
const webhookUrl = "http://localhost/api/stripe/webhook";
const secret = requiredEnv("STRIPE_WEBHOOK_SECRET");
const nowSeconds = () => Math.floor(Date.now() / 1000);

let ownerPool: pg.Pool;
let payerId = "";

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

/** Stripe's v1 signature: HMAC-SHA256 over the bytes of `<t>.` followed by the body bytes. */
function signatureOver(timestamp: number, body: Uint8Array<ArrayBuffer>): string {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
}

/** A delivery as Stripe signs it, with the body sent as the given text or bytes. */
function signedRequest(
  body: string | Uint8Array<ArrayBuffer>,
  timestamp = nowSeconds(),
  signature?: string,
): Request {
  const bytes: Uint8Array<ArrayBuffer> =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  return new Request(webhookUrl, {
    method: "POST",
    headers: {
      "stripe-signature": `t=${timestamp},v1=${signature ?? signatureOver(timestamp, bytes)}`,
    },
    body: new Blob([bytes]),
  });
}

const byteOrderMark = new Uint8Array([0xef, 0xbb, 0xbf]);

function withByteOrderMark(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...byteOrderMark, ...bytes]);
}

// Stripe's copy of each subscription, which GET /v1/subscriptions/{id} answers. A test stages the
// state Stripe holds at the moment the webhook reads it; events carry their own, possibly older, copy.
type StripeAnswer =
  | { readonly status: 200; readonly object: unknown }
  | { readonly status: 404 | 500 };
const stripeAnswers = new Map<string, StripeAnswer>();
// Each retrieve the webhook made: the subscription id and the Stripe-Version it sent.
const stripeCalls: { subscription: string; stripeVersion: string | null }[] = [];

interface SubscriptionOptions {
  subscriptionId: string;
  customerId: string;
  status?: string;
  periodEndInDays?: number;
  cancelAtPeriodEnd?: boolean;
  payer?: string | null;
  createdSecondsAgo?: number;
  type?: string;
  eventId?: string;
}

function subscriptionObject(options: SubscriptionOptions): Record<string, unknown> {
  const metadata = options.payer === null ? {} : { payer_id: options.payer ?? payerId };
  return {
    id: options.subscriptionId,
    object: "subscription",
    customer: options.customerId,
    status: options.status ?? "active",
    cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
    metadata,
    items: {
      data: [
        {
          price: { id: "price_test_monthly" },
          current_period_end: nowSeconds() + (options.periodEndInDays ?? 30) * 86400,
        },
      ],
    },
  };
}

/** The webhook body for one subscription event. It stages nothing: see `deliver`. */
function subscriptionEvent(options: SubscriptionOptions & { type: string }): string {
  return JSON.stringify({
    id: options.eventId ?? `evt_${randomUUID()}`,
    type: options.type,
    created: nowSeconds() - (options.createdSecondsAgo ?? 0),
    data: { object: subscriptionObject(options) },
  });
}

/** Stripe holds this state for the subscription when the webhook reads it. */
function stripeHolds(options: SubscriptionOptions): void {
  stripeAnswers.set(options.subscriptionId, { status: 200, object: subscriptionObject(options) });
}

/** Stripe holds the state this event describes, then the event is delivered. */
function deliver(options: SubscriptionOptions & { type: string }): Promise<Response> {
  stripeHolds(options);
  return handleApiRequest(signedRequest(subscriptionEvent(options)));
}

async function subscriptionRow(subscriptionId: string) {
  const result = await ownerPool.query(
    `select payer_id, stripe_customer_id, status, price_id, cancel_at_period_end, current_period_end
       from app_public.subscriptions where stripe_subscription_id = $1`,
    [subscriptionId],
  );
  return result.rows[0];
}

async function recordedEvent(eventId: string) {
  const result = await ownerPool.query(`select type from app_private.stripe_events where id = $1`, [
    eventId,
  ]);
  return result.rows[0];
}

const realFetch = globalThis.fetch;

beforeAll(async () => {
  // The webhook's one outbound call goes to Stripe's API. Stripe is answered from stripeAnswers;
  // any other URL reaches the network as usual.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== "api.stripe.com") {
      return realFetch(input, init);
    }
    const subscription = /^\/v1\/subscriptions\/([^/]+)$/.exec(url.pathname)?.[1] ?? "";
    stripeCalls.push({
      subscription,
      stripeVersion: request.headers.get("stripe-version"),
    });
    const answer = stripeAnswers.get(subscription);
    if (answer === undefined) {
      return new Response("no answer staged for this subscription", { status: 500 });
    }
    if (answer.status === 200) {
      return Response.json(answer.object);
    }
    return Response.json({ error: { type: "invalid_request_error" } }, { status: answer.status });
  });

  ownerPool = new pg.Pool({ connectionString: forceIpv4(requiredEnv("DATABASE_URL")) });
  const username = `webhook_payer_${runId}`;
  const created = await ownerPool.query(
    `select id from app_private.really_create_user($1::citext, $1, null, true, $2::citext, $3)`,
    [username, `${username}@test.com`, `${username}123`],
  );
  payerId = created.rows[0].id;
  await ownerPool.query(`update app_public.users set role = 'parent' where id = $1`, [payerId]);
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await ownerPool?.end();
});

describe("Stripe webhook", () => {
  it("applies a subscription.created event whose body is not canonical JSON, so the signature covers the exact bytes", async () => {
    const options = {
      type: "customer.subscription.created",
      subscriptionId: `sub_${randomUUID()}`,
      customerId: `cus_${randomUUID()}`,
      periodEndInDays: 45,
    };
    stripeHolds(options);
    const canonical = subscriptionEvent(options);
    // Extra spaces and line breaks: a re-serialized body would not match the signature.
    const body = canonical.replaceAll(",", ",\n    ").replaceAll(":", " : ");

    const response = await handleApiRequest(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await subscriptionRow(options.subscriptionId)).toMatchObject({
      payer_id: payerId,
      stripe_customer_id: options.customerId,
      status: "active",
      price_id: "price_test_monthly",
      cancel_at_period_end: false,
    });
  });

  it("applies an event whose signed bytes begin with a byte-order mark, so the handler reads the body unchanged", async () => {
    const options = {
      type: "customer.subscription.created",
      subscriptionId: `sub_${randomUUID()}`,
      customerId: `cus_${randomUUID()}`,
    };
    stripeHolds(options);
    const json = new TextEncoder().encode(subscriptionEvent(options));

    const response = await handleApiRequest(signedRequest(withByteOrderMark(json)));

    expect(response.status).toBe(200);
    expect(await subscriptionRow(options.subscriptionId)).toMatchObject({
      stripe_customer_id: options.customerId,
    });
  });

  it("refuses a body whose bytes differ from the bytes that were signed", async () => {
    const eventId = `evt_${randomUUID()}`;
    const options = {
      type: "customer.subscription.created",
      eventId,
      subscriptionId: `sub_${randomUUID()}`,
      customerId: `cus_${randomUUID()}`,
    };
    const json = new TextEncoder().encode(subscriptionEvent(options));
    const timestamp = nowSeconds();
    const signature = signatureOver(timestamp, json);

    const response = await handleApiRequest(
      signedRequest(withByteOrderMark(json), timestamp, signature),
    );

    expect(response.status).toBe(400);
    expect(await subscriptionRow(options.subscriptionId)).toBeUndefined();
    expect(await recordedEvent(eventId)).toBeUndefined();
  });

  it("refuses a signature that does not match, and writes nothing", async () => {
    const eventId = `evt_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const body = subscriptionEvent({
      type: "customer.subscription.created",
      eventId,
      subscriptionId,
      customerId: `cus_${randomUUID()}`,
    });

    const response = await handleApiRequest(signedRequest(body, nowSeconds(), "00".repeat(32)));

    expect(response.status).toBe(400);
    expect(await subscriptionRow(subscriptionId)).toBeUndefined();
    expect(await recordedEvent(eventId)).toBeUndefined();
  });

  it("refuses a signature that is not hex, without a database write", async () => {
    const eventId = `evt_${randomUUID()}`;
    const body = subscriptionEvent({
      type: "customer.subscription.created",
      eventId,
      subscriptionId: `sub_${randomUUID()}`,
      customerId: `cus_${randomUUID()}`,
    });

    const response = await handleApiRequest(signedRequest(body, nowSeconds(), "not-hex!"));

    expect(response.status).toBe(400);
    expect(await recordedEvent(eventId)).toBeUndefined();
  });

  it("refuses a timestamp more than five minutes old, even with a valid signature", async () => {
    const subscriptionId = `sub_${randomUUID()}`;
    const body = subscriptionEvent({
      type: "customer.subscription.created",
      subscriptionId,
      customerId: `cus_${randomUUID()}`,
    });

    const response = await handleApiRequest(signedRequest(body, nowSeconds() - 6 * 60));

    expect(response.status).toBe(400);
    expect(await subscriptionRow(subscriptionId)).toBeUndefined();
  });

  it("answers 200 for a replayed event id, changes nothing, and makes no Stripe call", async () => {
    const eventId = `evt_${randomUUID()}`;
    const options = {
      type: "customer.subscription.created",
      eventId,
      subscriptionId: `sub_${randomUUID()}`,
      customerId: `cus_${randomUUID()}`,
      status: "active",
    };
    expect((await deliver(options)).status).toBe(200);
    const callsBeforeReplay = stripeCalls.length;

    const replay = await handleApiRequest(
      signedRequest(subscriptionEvent({ ...options, status: "canceled" })),
    );

    expect(replay.status).toBe(200);
    expect(stripeCalls.length).toBe(callsBeforeReplay);
    expect(await subscriptionRow(options.subscriptionId)).toMatchObject({ status: "active" });
  });

  it("applies customer.subscription.updated to the existing row", async () => {
    const subscriptionId = `sub_${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    await deliver({
      type: "customer.subscription.created",
      subscriptionId,
      customerId,
      createdSecondsAgo: 10,
    });

    const response = await deliver({
      type: "customer.subscription.updated",
      subscriptionId,
      customerId,
      status: "past_due",
      cancelAtPeriodEnd: true,
    });

    expect(response.status).toBe(200);
    expect(await subscriptionRow(subscriptionId)).toMatchObject({
      status: "past_due",
      cancel_at_period_end: true,
    });
  });

  it("applies customer.subscription.deleted as a canceled subscription", async () => {
    const subscriptionId = `sub_${randomUUID()}`;

    const response = await deliver({
      type: "customer.subscription.deleted",
      subscriptionId,
      customerId: `cus_${randomUUID()}`,
      status: "canceled",
    });

    expect(response.status).toBe(200);
    expect(await subscriptionRow(subscriptionId)).toMatchObject({ status: "canceled" });
  });

  it("answers 200 and records checkout.session.completed without writing a subscription", async () => {
    const eventId = `evt_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const body = JSON.stringify({
      id: eventId,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${randomUUID()}`,
          object: "checkout.session",
          customer: `cus_${randomUUID()}`,
          subscription: subscriptionId,
          client_reference_id: payerId,
        },
      },
    });

    const response = await handleApiRequest(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await recordedEvent(eventId)).toEqual({ type: "checkout.session.completed" });
    expect(await subscriptionRow(subscriptionId)).toBeUndefined();
  });

  it("answers 200 and records an unknown event type", async () => {
    const eventId = `evt_${randomUUID()}`;
    const body = JSON.stringify({ id: eventId, type: "invoice.paid", data: { object: {} } });

    const response = await handleApiRequest(signedRequest(body));

    expect(response.status).toBe(200);
    expect(await recordedEvent(eventId)).toEqual({ type: "invoice.paid" });
  });

  it("keeps the newer row when an older updated event arrives after it", async () => {
    const subscriptionId = `sub_${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    await deliver({
      type: "customer.subscription.updated",
      subscriptionId,
      customerId,
      status: "active",
      createdSecondsAgo: 0,
    });

    // Stripe now answers a state that differs from the newer row. Only the ordering guard keeps
    // the row as it is: the older event's time is earlier than the row's.
    const response = await deliver({
      type: "customer.subscription.updated",
      subscriptionId,
      customerId,
      status: "past_due",
      createdSecondsAgo: 120,
    });

    expect(response.status).toBe(200);
    expect(await subscriptionRow(subscriptionId)).toMatchObject({ status: "active" });
  });

  it("keeps a row when an older deleted event arrives after a newer update", async () => {
    const subscriptionId = `sub_${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    await deliver({
      type: "customer.subscription.updated",
      subscriptionId,
      customerId,
      status: "active",
      createdSecondsAgo: 0,
    });

    const response = await deliver({
      type: "customer.subscription.deleted",
      subscriptionId,
      customerId,
      status: "canceled",
      createdSecondsAgo: 120,
    });

    expect(response.status).toBe(200);
    expect(await subscriptionRow(subscriptionId)).toMatchObject({ status: "active" });
  });

  it("applies a created and an updated event with the same created second as Stripe's current state, and reads it at the pinned version", async () => {
    const options = {
      subscriptionId: `sub_${randomUUID()}`,
      customerId: `cus_${randomUUID()}`,
      createdSecondsAgo: 0,
    };
    // Checkout sends created (incomplete) and updated (active) within a second. Stripe's current
    // state is active, and that is the state the row must end with.
    stripeHolds({ ...options, status: "active" });

    const created = await handleApiRequest(
      signedRequest(
        subscriptionEvent({
          ...options,
          type: "customer.subscription.created",
          status: "incomplete",
        }),
      ),
    );
    const updated = await deliver({ ...options, type: "customer.subscription.updated" });

    expect(created.status).toBe(200);
    expect(updated.status).toBe(200);
    expect(await subscriptionRow(options.subscriptionId)).toMatchObject({ status: "active" });
    expect(stripeCalls.at(-1)).toEqual({
      subscription: options.subscriptionId,
      stripeVersion: stripeApiVersion,
    });
  });

  it("marks the row canceled when Stripe no longer has the subscription", async () => {
    const subscriptionId = `sub_${randomUUID()}`;
    const customerId = `cus_${randomUUID()}`;
    await deliver({
      type: "customer.subscription.created",
      subscriptionId,
      customerId,
      createdSecondsAgo: 10,
    });
    stripeAnswers.set(subscriptionId, { status: 404 });

    const response = await handleApiRequest(
      signedRequest(
        subscriptionEvent({
          type: "customer.subscription.updated",
          subscriptionId,
          customerId,
          status: "active",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await subscriptionRow(subscriptionId)).toMatchObject({ status: "canceled" });
  });

  it("answers 500 and records no event when the Stripe retrieve fails, so Stripe retries", async () => {
    const eventId = `evt_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    stripeAnswers.set(subscriptionId, { status: 500 });

    const response = await handleApiRequest(
      signedRequest(
        subscriptionEvent({
          type: "customer.subscription.created",
          eventId,
          subscriptionId,
          customerId: `cus_${randomUUID()}`,
        }),
      ),
    );

    expect(response.status).toBe(500);
    expect(await recordedEvent(eventId)).toBeUndefined();
    expect(await subscriptionRow(subscriptionId)).toBeUndefined();
  });

  it("records an event whose payer has no user, answers 200, and writes no row", async () => {
    const eventId = `evt_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;
    const options = {
      type: "customer.subscription.created",
      eventId,
      subscriptionId,
      customerId: `cus_${randomUUID()}`,
      payer: randomUUID(),
    };

    const response = await deliver(options);

    expect(response.status).toBe(200);
    expect(await recordedEvent(eventId)).toEqual({ type: "customer.subscription.created" });
    expect(await subscriptionRow(subscriptionId)).toBeUndefined();
  });

  it("records a subscription with no payer_id and writes no row for it", async () => {
    const eventId = `evt_${randomUUID()}`;
    const subscriptionId = `sub_${randomUUID()}`;

    const response = await deliver({
      type: "customer.subscription.created",
      eventId,
      subscriptionId,
      customerId: `cus_${randomUUID()}`,
      payer: null,
    });

    expect(response.status).toBe(200);
    expect(await recordedEvent(eventId)).toEqual({ type: "customer.subscription.created" });
    expect(await subscriptionRow(subscriptionId)).toBeUndefined();
  });
});
