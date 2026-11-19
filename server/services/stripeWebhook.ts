import {
  Clock,
  Config,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Result,
  Schema as S,
} from "effect";
import { Hex } from "effect/encoding";
import { PgRootDB } from "../db.js";
import { HttpError } from "../pgErrors.js";
import { Stripe, StripeSubscription } from "./stripe.js";
import { notConfigured } from "./stripeErrors.js";

// Stripe signs each delivery with a timestamp and rejects a signature older than this many seconds.
const toleranceSeconds = 300;

// The subscription events the webhook applies. Any other type is recorded and answered 200.
const SubscriptionEventType = S.Literals([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

// `created` is the event's Unix-seconds time (docs.stripe.com/api/events/object: "Measured in
// seconds since the Unix epoch"). It orders deliveries, which Stripe does not.
const SubscriptionEvent = S.Struct({
  id: S.String,
  type: SubscriptionEventType,
  created: S.Finite,
  data: S.Struct({ object: StripeSubscription }),
});

// Every event has an id and a type. The type decides whether the full event is decoded.
const Envelope = S.Struct({ id: S.String, type: S.String });

// Fatal on invalid UTF-8, so a body that is not text is refused after its signature is checked.
// A leading byte-order mark is stripped, which is harmless: the signature already covered it.
const utf8 = new TextDecoder("utf-8", { fatal: true });

const malformed = (message: string) => new HttpError({ status: 400, message });

/**
 * Checks the Stripe-Signature header against the raw request bytes, as Stripe specifies: the
 * header holds `t=<unix seconds>` and one or more `v1=<hex HMAC-SHA256>`, and each HMAC covers the
 * bytes of `<t>.` followed by the body bytes. Working on bytes keeps any byte the text decoder
 * would change inside the signed data.
 */
const verifySignature = Effect.fnUntraced(function* (
  secret: Redacted.Redacted<string>,
  body: Uint8Array,
  header: string | undefined,
) {
  if (header === undefined) {
    return yield* malformed("Stripe-Signature header is missing");
  }
  const fields = header.split(",").flatMap((part) => {
    const [name, value] = part.split("=", 2);
    return name !== undefined && value !== undefined ? [{ name, value }] : [];
  });
  const timestamp = fields.find((field) => field.name === "t")?.value;
  const signatures = fields.filter((field) => field.name === "v1").map((field) => field.value);
  if (timestamp === undefined || !/^\d+$/.test(timestamp) || signatures.length === 0) {
    return yield* malformed("Stripe-Signature header is malformed");
  }

  const nowSeconds = (yield* Clock.currentTimeMillis) / 1000;
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) {
    return yield* malformed("Stripe event timestamp is outside the tolerance");
  }

  const key = yield* Effect.tryPromise(() =>
    crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(Redacted.value(secret)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    ),
  );
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);
  // crypto.subtle.verify compares in constant time. A signature that is not hex cannot match.
  const matches = yield* Effect.forEach(signatures, (hex) => {
    const bytes = Hex.decode(hex);
    return Result.isSuccess(bytes)
      ? Effect.tryPromise(() =>
          crypto.subtle.verify("HMAC", key, new Uint8Array(bytes.success), signed),
        )
      : Effect.succeed(false);
  });
  if (!matches.some(Boolean)) {
    return yield* malformed("No Stripe signature matches the request body");
  }
});

type SubscriptionEventValue = typeof SubscriptionEvent.Type;
type SubscriptionWrite = {
  readonly event: SubscriptionEventValue;
  readonly object: typeof StripeSubscription.Type;
};

/** Applies Stripe's webhook events to app_public.subscriptions, once per event id. */
export class StripeWebhook extends Context.Service<StripeWebhook>()("dfg-rocks/stripeWebhook", {
  make: Effect.gen(function* () {
    const rootDb = yield* PgRootDB;
    const stripe = yield* Stripe;

    // The row takes the subscription as Stripe holds it now, not the copy inside the event. A
    // delivery can be a snapshot from before a later change, so the event's copy may be stale.
    // A subscription Stripe no longer has (404) is written as canceled, from the event's ids.
    const latestState = Effect.fnUntraced(function* (event: SubscriptionEventValue) {
      const latest = yield* stripe.retrieveSubscription(event.data.object.id);
      return Option.match(latest, {
        onNone: () => ({ ...event.data.object, status: "canceled" }),
        onSome: (object) => object,
      });
    });

    // Upserts on the Stripe subscription id. A row is overwritten by an event created no earlier
    // than the event that wrote it, so an older delivery cannot undo a newer one. Equal times (two
    // events in the same second) write the current state, which is the same either way. One
    // statement inserts only when the payer still has a user, so a user deleted meanwhile cannot
    // fail the foreign key.
    const applySubscription = Effect.fnUntraced(function* (write: SubscriptionWrite) {
      const { event, object } = write;
      const payerId = object.metadata.payer_id;
      if (payerId === undefined) {
        return yield* Effect.logWarning(
          "Stripe subscription has no payer_id; the event is recorded and no row is written",
          { event: event.id, subscription: object.id },
        );
      }
      const item = object.items.data[0];
      // One row built from the subscription's values, selected only while the payer's user exists.
      const source = rootDb
        .selectNoFrom((eb) => [
          eb.val(payerId).as("payer_id"),
          eb.val(object.customer).as("stripe_customer_id"),
          eb.val(object.id).as("stripe_subscription_id"),
          eb.val(object.status).as("status"),
          eb.val(item.price.id).as("price_id"),
          eb.val(item.price.metadata.plan ?? null).as("plan"),
          eb.val(new Date(item.current_period_end * 1000)).as("current_period_end"),
          eb.val(object.cancel_at_period_end).as("cancel_at_period_end"),
          eb.val(new Date(event.created * 1000)).as("stripe_event_created"),
        ])
        .where((eb) =>
          eb.exists(eb.selectFrom("app_public.users").select("id").where("id", "=", payerId)),
        );
      const written = yield* rootDb.execute(
        rootDb
          .insertInto("app_public.subscriptions")
          .columns([
            "payer_id",
            "stripe_customer_id",
            "stripe_subscription_id",
            "status",
            "price_id",
            "plan",
            "current_period_end",
            "cancel_at_period_end",
            "stripe_event_created",
          ])
          .expression(source)
          .onConflict((oc) =>
            oc
              .column("stripe_subscription_id")
              .doUpdateSet((eb) => ({
                stripe_customer_id: eb.ref("excluded.stripe_customer_id"),
                status: eb.ref("excluded.status"),
                price_id: eb.ref("excluded.price_id"),
                plan: eb.ref("excluded.plan"),
                current_period_end: eb.ref("excluded.current_period_end"),
                cancel_at_period_end: eb.ref("excluded.cancel_at_period_end"),
                stripe_event_created: eb.ref("excluded.stripe_event_created"),
              }))
              .where((eb) =>
                eb(
                  "app_public.subscriptions.stripe_event_created",
                  "<=",
                  eb.ref("excluded.stripe_event_created"),
                ),
              ),
          )
          .returning("id"),
      );
      if (written.length > 0) {
        return;
      }
      // No row was written: either the payer has no user, or the stored row is newer than this event.
      const payer = yield* rootDb.execute(
        rootDb.selectFrom("app_public.users").select("id").where("id", "=", payerId),
      );
      if (payer.length === 0) {
        return yield* Effect.logWarning("Stripe subscription payer has no user; not written", {
          event: event.id,
          subscription: object.id,
          payer_id: payerId,
        });
      }
      yield* Effect.logInfo("Stripe event is older than the stored subscription; not written", {
        event: event.id,
        subscription: object.id,
      });
    });

    return {
      /**
       * Verifies and applies one delivery. The event id is inserted in the same transaction as the
       * event's effect: a redelivered id matches the existing row and changes nothing. A replayed id
       * is answered before any Stripe call, so a replay costs no request.
       */
      receive: Effect.fn("receive")(function* (body: Uint8Array, signature: string | undefined) {
        const secret = yield* Config.Redacted("STRIPE_WEBHOOK_SECRET").pipe(
          Effect.mapError(notConfigured),
        );
        yield* verifySignature(secret, body, signature);

        // Decoded only after the signature passes, from the same bytes that were signed.
        const text = yield* Effect.try({
          try: () => utf8.decode(body),
          catch: () => malformed("Stripe event body is not UTF-8"),
        });
        const envelope = yield* S.decodeEffect(S.fromJsonString(Envelope))(text).pipe(
          Effect.mapError(() => malformed("Stripe event is not valid JSON")),
        );
        const subscription = S.is(SubscriptionEventType)(envelope.type)
          ? Option.some(
              yield* S.decodeEffect(S.fromJsonString(SubscriptionEvent))(text).pipe(
                Effect.mapError(() => malformed("Stripe subscription event does not match")),
              ),
            )
          : Option.none();

        const alreadyRecorded = yield* rootDb.withTransaction(
          rootDb
            .execute(
              rootDb
                .selectFrom("app_private.stripe_events")
                .select("id")
                .where("id", "=", envelope.id),
            )
            .pipe(Effect.map((rows) => rows.length > 0)),
        );
        if (alreadyRecorded) {
          yield* Effect.logInfo("Stripe event already applied", { event: envelope.id });
          return;
        }

        // Stripe is called before the transaction opens: no HTTP call runs inside a database
        // transaction. A failed call throws here, so the event id is never recorded and Stripe retries.
        const write: Option.Option<SubscriptionWrite> = Option.isSome(subscription)
          ? Option.some({
              event: subscription.value,
              object: yield* latestState(subscription.value),
            })
          : Option.none();

        yield* rootDb.withTransaction(
          Effect.gen(function* () {
            // The insert is the authority for concurrent deliveries of one id: only one of them
            // gets a row back.
            const recorded = yield* rootDb.execute(
              rootDb
                .insertInto("app_private.stripe_events")
                .values({ id: envelope.id, type: envelope.type })
                .onConflict((oc) => oc.column("id").doNothing())
                .returning("id"),
            );
            if (recorded.length === 0) {
              yield* Effect.logInfo("Stripe event already applied", { event: envelope.id });
              return;
            }
            if (Option.isSome(write)) {
              yield* applySubscription(write.value);
            }
          }),
        );
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Layer.mergeAll(PgRootDB.layer, Stripe.layer)),
  );
}
