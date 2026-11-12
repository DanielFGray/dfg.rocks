import { expect, it } from "@effect/vitest";
import { Effect, Ref, Schema } from "effect";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { PgRootDB } from "../db.js";
import { GoogleCalendarService } from "../services/googleCalendarService.js";

const eventId = "df9123e4567e89b12d3a456426614174000";
const event = {
  id: eventId,
  summary: "Lesson: Ada",
  start: "2026-07-14T15:00:00.000Z",
  end: "2026-07-14T16:00:00.000Z",
};

it.layer(PgRootDB.Live)("Google Calendar retry contracts", (test) => {
  test.effect("creates the caller's stable event ID", () =>
    Effect.gen(function* () {
      yield* configureCalendar;
      const http = yield* calendarHttp(() => Response.json({ id: eventId, start: {}, end: {} }));
      const id = yield* GoogleCalendarService.make.pipe(
        Effect.flatMap((calendar) => calendar.createEvent(event)),
        Effect.provideService(HttpClient.HttpClient, http.client),
      );
      expect(id).toBe(eventId);
      const requests = yield* http.requests;
      expect(requests.map(({ method }) => method)).toEqual(["POST"]);
      const body = requests[0]?.body;
      if (!body || body._tag !== "Uint8Array")
        return yield* Effect.fail(new Error("Expected an encoded Google event"));
      const payload = yield* Schema.decodeUnknownEffect(
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
        yield* GoogleCalendarService.make.pipe(
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
      const error = yield* GoogleCalendarService.make.pipe(
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
      const error = yield* GoogleCalendarService.make.pipe(
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
        yield* GoogleCalendarService.make.pipe(
          Effect.flatMap((calendar) => calendar.deleteEvent(eventId)),
          Effect.provideService(HttpClient.HttpClient, http.client),
        );
        expect((yield* http.requests).map(({ method }) => method)).toEqual(["DELETE"]);
      }).pipe(Effect.scoped),
    );
  }
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
