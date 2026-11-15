import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { PgRootDB } from "../db.js";
import { InProcessApi } from "../inProcessApi.js";
import { applicationLayer } from "../runtime.js";
import { Contact } from "../services/contact.js";
import { Worker } from "../../worker/worker.js";

const runId = Math.random().toString(36).slice(2, 8);

const submission = (email: string) => ({
  name: "Jane Doe",
  email,
  instrument: "piano",
  format: "in-person",
  message: "Looking for lessons",
});

const savedRow = (email: string) =>
  Effect.gen(function* () {
    const db = yield* PgRootDB;
    const rows = yield* db.execute(
      db
        .selectFrom("app_public.contact_submissions")
        .select(["ip_address", "location_country", "location_region", "location_city"])
        .where("email", "=", email),
    );
    return Option.fromNullishOr(rows[0]);
  });

// ip-api.com as the Geolocation service sees it, keyed by the looked-up address.
const ipApi = HttpClient.make((request, url) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      url.pathname.endsWith("/198.51.100.20")
        ? Response.json({ status: "success", countryCode: "US", region: "TX", city: "Houston" })
        : url.pathname.endsWith("/198.51.100.30")
          ? Response.json({ status: "success", countryCode: "US", region: "CA", city: "Fresno" })
          : new Response("quota exceeded", { status: 429 }),
    ),
  ),
);

describe("contact form", () => {
  it.layer(
    Layer.mergeAll(
      PgRootDB.layer,
      Contact.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, ipApi))),
    ),
  )("Contact service", (it) => {
    it.effect("saves a visitor located in Texas with their location", () =>
      Effect.gen(function* () {
        const email = `texas_${runId}@example.com`;
        const contact = yield* Contact;
        yield* contact.submitContact(submission(email), Option.some("198.51.100.20"));
        expect(yield* savedRow(email)).toEqual(
          Option.some({
            ip_address: "198.51.100.20",
            location_country: "US",
            location_region: "TX",
            location_city: "Houston",
          }),
        );
      }),
    );

    it.effect("refuses a visitor located outside Texas and saves nothing", () =>
      Effect.gen(function* () {
        const email = `california_${runId}@example.com`;
        const contact = yield* Contact;
        const error = yield* contact
          .submitContact(submission(email), Option.some("198.51.100.30"))
          .pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "HttpError", status: 403 });
        expect(yield* savedRow(email)).toEqual(Option.none());
      }),
    );

    it.effect("saves a visitor whose location lookup failed, without a location", () =>
      Effect.gen(function* () {
        const email = `unknown_${runId}@example.com`;
        const contact = yield* Contact;
        yield* contact.submitContact(submission(email), Option.some("198.51.100.40"));
        expect(yield* savedRow(email)).toEqual(
          Option.some({
            ip_address: "198.51.100.40",
            location_country: null,
            location_region: null,
            location_city: null,
          }),
        );
      }),
    );

    it.effect("refuses a filled honeypot field", () =>
      Effect.gen(function* () {
        const email = `honeypot_${runId}@example.com`;
        const contact = yield* Contact;
        const error = yield* contact
          .submitContact({ ...submission(email), website: "http://spam.example" }, Option.none())
          .pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "HttpError", status: 400 });
        expect(yield* savedRow(email)).toEqual(Option.none());
      }),
    );
  });

  // The server function's path: the typed client over the API handler in this process.
  it.layer(
    InProcessApi.layer.pipe(
      Layer.provideMerge(Layer.succeed(Worker, { isRunning: Effect.succeed(true) })),
      Layer.provideMerge(applicationLayer),
    ),
  )("in-process API", (it) => {
    it.effect("delivers the visitor's address to /api/contact", () =>
      Effect.gen(function* () {
        const email = `in_process_${runId}@example.com`;
        const inProcess = yield* InProcessApi;
        // A documentation address: ip-api.com has no location for it, so the lookup answers
        // "unknown" whether or not the network is up, and the visitor is accepted.
        const api = yield* inProcess.clientFor(
          new Request("http://dfg.test/", { headers: { "x-real-ip": "192.0.2.10" } }),
        );
        yield* api.public.contact({ payload: submission(email) });
        expect(Option.map(yield* savedRow(email), (row) => row.ip_address)).toEqual(
          Option.some("192.0.2.10"),
        );
      }),
    );
  });
});
