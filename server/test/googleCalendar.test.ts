import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { PgRootDB } from "../db.js";
import { GoogleCalendar } from "../services/googleCalendar.js";

const eventId = "df9123e4567e89b12d3a456426614174000";
const event = {
  id: eventId,
  summary: "Lesson: Ada",
  start: "2026-07-14T15:00:00.000Z",
  end: "2026-07-14T16:00:00.000Z",
};

it.layer(PgRootDB.layer)("Google Calendar retry contracts", (test) => {
  test.effect("reports when no Google Calendar refresh token is stored", () =>
    Effect.gen(function* () {
      yield* withoutRefreshToken;
      const result = yield* GoogleCalendar.make.pipe(
        Effect.flatMap((calendar) =>
          calendar.getAvailableSlots({ date: "2026-07-14", days: 7, duration: 60 }),
        ),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die(new Error("Google Calendar must not be called"))),
        ),
      );
      expect(result).toEqual({ _tag: "CalendarNotConnected" });
    }).pipe(Effect.scoped),
  );

  test.effect("creates the caller's stable event ID", () =>
    Effect.gen(function* () {
      yield* configureCalendar;
      const http = yield* calendarHttp(() => Response.json({ id: eventId, start: {}, end: {} }));
      const id = yield* GoogleCalendar.make.pipe(
        Effect.flatMap((calendar) => calendar.createEvent(event)),
        Effect.provideService(HttpClient.HttpClient, http.client),
      );
      expect(id).toBe(eventId);
      const requests = yield* http.requests;
      expect(requests.map(({ method }) => method)).toEqual(["POST"]);
      const body = requests[0]?.body;
      if (!body || body._tag !== "Uint8Array")
        return yield* Effect.die(new Error("Expected an encoded Google event"));
      const payload = yield* Schema.decodeEffect(
        Schema.fromJsonString(Schema.Struct({ id: Schema.String })),
      )(new TextDecoder().decode(body.body));
      expect(payload).toEqual({ id: eventId });
    }).pipe(Effect.scoped),
  );

  test.effect("confirms a 409 conflict and returns the existing stable ID", () =>
    Effect.gen(function* () {
      yield* configureCalendar;
      const http = yield* calendarHttp((method) =>
        method === "POST"
          ? new Response("conflict", { status: 409 })
          : Response.json({ id: eventId, start: {}, end: {} }),
      );
      expect(
        yield* GoogleCalendar.make.pipe(
          Effect.flatMap((calendar) => calendar.createEvent(event)),
          Effect.provideService(HttpClient.HttpClient, http.client),
        ),
      ).toBe(eventId);
      expect((yield* http.requests).map(({ method, url }) => ({ method, url }))).toEqual([
        { method: "POST", url: "https://www.googleapis.com/calendar/v3/calendars/primary/events" },
        {
          method: "GET",
          url: `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        },
      ]);
    }).pipe(Effect.scoped),
  );

  test.effect("rejects a conflicting event with a different ID", () =>
    Effect.gen(function* () {
      yield* configureCalendar;
      const http = yield* calendarHttp((method) =>
        method === "POST"
          ? new Response("", { status: 409 })
          : Response.json({ id: "unexpected", start: {}, end: {} }),
      );
      const error = yield* GoogleCalendar.make.pipe(
        Effect.flatMap((calendar) => calendar.createEvent(event)),
        Effect.provideService(HttpClient.HttpClient, http.client),
        Effect.flip,
      );
      expect(error).toMatchObject({
        _tag: "HttpError",
        status: 502,
        message: "Google returned an unexpected event ID",
      });
    }).pipe(Effect.scoped),
  );

  test.effect("leaves API failures failed so graphile-worker retries", () =>
    Effect.gen(function* () {
      yield* configureCalendar;
      const http = yield* calendarHttp(() => new Response("quota", { status: 503 }));
      const error = yield* GoogleCalendar.make.pipe(
        Effect.flatMap((calendar) => calendar.createEvent(event)),
        Effect.provideService(HttpClient.HttpClient, http.client),
        Effect.flip,
      );
      expect(error).toMatchObject({ _tag: "HttpError", status: 503, message: "quota" });
    }).pipe(Effect.scoped),
  );

  for (const status of [404, 410]) {
    test.effect(`an event already gone with ${status} is deleted successfully`, () =>
      Effect.gen(function* () {
        yield* configureCalendar;
        const http = yield* calendarHttp(() => new Response("gone", { status }));
        yield* GoogleCalendar.make.pipe(
          Effect.flatMap((calendar) => calendar.deleteEvent(eventId)),
          Effect.provideService(HttpClient.HttpClient, http.client),
        );
        expect((yield* http.requests).map(({ method }) => method)).toEqual(["DELETE"]);
      }).pipe(Effect.scoped),
    );
  }
});

it.layer(PgRootDB.layer)("Google Calendar sync paging", (test) => {
  const syncChanges = (http: { client: HttpClient.HttpClient }) =>
    GoogleCalendar.make.pipe(
      Effect.flatMap((calendar) => calendar.syncChanges()),
      Effect.provideService(HttpClient.HttpClient, http.client),
    );

  test.effect("an incremental sync follows every page before returning the final token", () =>
    Effect.gen(function* () {
      const db = yield* PgRootDB;
      yield* configureCalendar;
      yield* withSyncToken("t-old");
      const http = yield* calendarHttp((_method, url) =>
        url.searchParams.has("pageToken")
          ? Response.json({
              items: [{ id: "evt-page-2", start: {} }],
              nextSyncToken: "t-new",
            })
          : Response.json({
              items: [{ id: "evt-page-1", start: {} }],
              nextPageToken: "p2",
            }),
      );
      const changes = yield* syncChanges(http);
      expect(changes.events.map((event) => event.id)).toEqual(["evt-page-1", "evt-page-2"]);
      expect(changes.nextSyncToken).toBe("t-new");
      expect((yield* http.requests).map(({ method, url }) => ({ method, url }))).toEqual([
        {
          method: "GET",
          url: "https://www.googleapis.com/calendar/v3/calendars/primary/events?syncToken=t-old",
        },
        {
          method: "GET",
          url: "https://www.googleapis.com/calendar/v3/calendars/primary/events?syncToken=t-old&pageToken=p2",
        },
      ]);
      // The caller stores the token only after applying the returned changes.
      expect(yield* readSyncToken(db)).toBe("t-old");
    }).pipe(Effect.scoped),
  );

  test.effect("empty pages flow through and still produce the final token", () =>
    Effect.gen(function* () {
      yield* configureCalendar;
      yield* withSyncToken("t-old");
      const http = yield* calendarHttp((_method, url) =>
        url.searchParams.has("pageToken")
          ? Response.json({ items: [], nextSyncToken: "t-new" })
          : Response.json({ items: [], nextPageToken: "p2" }),
      );
      const changes = yield* syncChanges(http);
      expect(changes.events).toEqual([]);
      expect(changes.nextSyncToken).toBe("t-new");
      expect(
        (yield* http.requests).map(({ url }) => new URL(url).searchParams.get("pageToken")),
      ).toEqual([null, "p2"]);
    }).pipe(Effect.scoped),
  );

  test.effect("a 410 expired sync token recovers with a full sync", () =>
    Effect.gen(function* () {
      const db = yield* PgRootDB;
      yield* configureCalendar;
      yield* withSyncToken("expired");
      const http = yield* calendarHttp((_method, url) =>
        url.searchParams.has("syncToken")
          ? new Response("expired", { status: 410 })
          : Response.json({ items: [{ id: "evt-full", start: {} }], nextSyncToken: "t-full" }),
      );
      const changes = yield* syncChanges(http);
      expect(changes.events.map((event) => event.id)).toEqual(["evt-full"]);
      expect(changes.nextSyncToken).toBe("t-full");
      const [expired, full] = yield* http.requests;
      expect(new URL(expired!.url).searchParams.get("syncToken")).toBe("expired");
      expect(new URL(full!.url).searchParams.get("timeMin")).not.toBeNull();
      expect(new URL(full!.url).searchParams.get("singleEvents")).toBe("true");
      expect(new URL(full!.url).searchParams.has("syncToken")).toBe(false);
      expect(yield* readSyncToken(db)).toBeNull();
    }).pipe(Effect.scoped),
  );

  test.effect("an empty stored token syncs fully instead of asking Google for it", () =>
    Effect.gen(function* () {
      yield* configureCalendar;
      yield* withSyncToken("");
      const http = yield* calendarHttp((_method, url) =>
        url.searchParams.has("syncToken")
          ? new Response("bad request", { status: 400 })
          : Response.json({ items: [], nextSyncToken: "t-full" }),
      );
      const changes = yield* syncChanges(http);
      expect(changes.events).toEqual([]);
      expect(changes.nextSyncToken).toBe("t-full");
      const [request] = yield* http.requests;
      expect(new URL(request!.url).searchParams.has("syncToken")).toBe(false);
    }).pipe(Effect.scoped),
  );

  test.effect("a response that ends without a sync token fails", () =>
    Effect.gen(function* () {
      yield* configureCalendar;
      yield* withSyncToken("t-old");
      const http = yield* calendarHttp((_method, url) =>
        url.searchParams.has("pageToken")
          ? Response.json({ items: [] })
          : Response.json({ items: [], nextPageToken: "p2" }),
      );
      const error = yield* syncChanges(http).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "HttpError",
        status: 502,
        message: "Google Calendar sync ended without a sync token",
      });
    }).pipe(Effect.scoped),
  );
});

const calendarHttp = (respond: (method: string, url: URL) => Response) =>
  Effect.gen(function* () {
    const requests = yield* Ref.make<
      ReadonlyArray<{ method: string; url: string; body: HttpBody.HttpBody }>
    >([]);
    const client = HttpClient.make((request, url) =>
      Ref.update(requests, (all) => [
        ...all,
        { method: request.method, url: url.toString(), body: request.body },
      ]).pipe(Effect.as(HttpClientResponse.fromWeb(request, respond(request.method, url)))),
    );
    return { client, requests: Ref.get(requests) };
  });

const configureCalendar = Effect.acquireRelease(
  Effect.gen(function* () {
    const db = yield* PgRootDB;
    const keys = ["gcal_access_token", "gcal_access_token_expires_at", "gcal_calendar_id"];
    const previous = yield* db.execute(
      db.selectFrom("app_private.admin_settings").select(["key", "value"]).where("key", "in", keys),
    );
    yield* db.execute(
      db
        .insertInto("app_private.admin_settings")
        .values([
          { key: keys[0], value: JSON.stringify("cached-token") },
          { key: keys[1], value: JSON.stringify(Date.now() + 300000) },
          { key: keys[2], value: JSON.stringify("primary") },
        ])
        .onConflict((oc) =>
          oc.column("key").doUpdateSet((eb) => ({ value: eb.ref("excluded.value") })),
        ),
    );
    return { db, keys, previous };
  }),
  ({ db, keys, previous }) =>
    Effect.gen(function* () {
      yield* db.execute(db.deleteFrom("app_private.admin_settings").where("key", "in", keys));
      if (previous.length)
        yield* db.execute(
          db
            .insertInto("app_private.admin_settings")
            .values(previous.map((row) => ({ key: row.key, value: JSON.stringify(row.value) }))),
        );
    }).pipe(Effect.orDie),
);

const withoutRefreshToken = Effect.acquireRelease(
  Effect.gen(function* () {
    const db = yield* PgRootDB;
    const key = "gcal_refresh_token";
    const previous = yield* db.execute(
      db.selectFrom("app_private.admin_settings").select(["key", "value"]).where("key", "=", key),
    );
    yield* db.execute(db.deleteFrom("app_private.admin_settings").where("key", "=", key));
    return { db, key, previous };
  }),
  ({ db, key, previous }) =>
    Effect.gen(function* () {
      yield* db.execute(db.deleteFrom("app_private.admin_settings").where("key", "=", key));
      if (previous.length)
        yield* db.execute(
          db
            .insertInto("app_private.admin_settings")
            .values(previous.map((row) => ({ key: row.key, value: JSON.stringify(row.value) }))),
        );
    }).pipe(Effect.orDie),
);

const syncTokenKey = "gcal_sync_token";

/** Stores a sync token for one test and deletes it afterwards. */
const withSyncToken = (value: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const db = yield* PgRootDB;
      yield* db.execute(
        db
          .insertInto("app_private.admin_settings")
          .values({ key: syncTokenKey, value: JSON.stringify(value) })
          .onConflict((oc) => oc.column("key").doUpdateSet({ value: JSON.stringify(value) })),
      );
      return db;
    }),
    (db) =>
      db.execute(db.deleteFrom("app_private.admin_settings").where("key", "=", syncTokenKey)).pipe(
        Effect.orDie,
      ),
  );

const readSyncToken = (db: PgRootDB["Service"]) =>
  db
    .execute(
      db
        .selectFrom("app_private.admin_settings")
        .select("value")
        .where("key", "=", syncTokenKey),
    )
    .pipe(
      Effect.head,
      Effect.option,
      Effect.map((row) => {
        const value = Option.getOrNull(row)?.value;
        return typeof value === "string" ? value : null;
      }),
    );
