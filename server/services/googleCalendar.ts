import {
  ArcticFetchError,
  Google,
  OAuth2RequestError,
  generateCodeVerifier,
  generateState,
} from "arctic";
import { Config, Duration, Effect, Option, Context, Layer, Redacted } from "effect";
import * as S from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpBody from "effect/http/HttpBody";
import { PgRootDB } from "../db.js";
import { HttpError } from "../pgErrors.js";
import { type TimeSlot, WorkingHours } from "../../shared/schemas.js";
import { defaultWorkingHours } from "../../shared/workingHours.js";

// Types
interface GcalEventTime {
  dateTime?: string;
  date?: string;
}

interface GcalEvent {
  id: string;
  summary?: string;
  description?: string;
  start: GcalEventTime;
  end: GcalEventTime;
  status?: string;
}

const GoogleCalendarAuthStateSchema = S.Struct({
  codeVerifier: S.String,
  redirect: S.String,
  state: S.String,
});

const GcalEventTimeSchema = S.Struct({
  dateTime: S.optional(S.String),
  date: S.optional(S.String),
});

const GcalEventSchema = S.Struct({
  id: S.String,
  summary: S.optional(S.String),
  description: S.optional(S.String),
  start: GcalEventTimeSchema,
  end: GcalEventTimeSchema,
  status: S.optional(S.String),
});

const GcalChangeSchema = S.Struct({
  id: S.String,
  status: S.optional(S.String),
  start: S.optional(GcalEventTimeSchema),
});
const GcalChangesSchema = S.Struct({
  items: S.optional(S.Array(GcalChangeSchema)),
  nextSyncToken: S.optional(S.String),
  nextPageToken: S.optional(S.String),
});

const GcalEventListSchema = S.Struct({
  items: S.optional(S.Array(GcalEventSchema)),
  nextPageToken: S.optional(S.String),
  nextSyncToken: S.optional(S.String),
});

const RefreshTokenResponseSchema = S.Struct({
  access_token: S.String,
  expires_in: S.Finite,
});

// Constants
const GCAL_BASE = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CONNECT_REDIRECT_PATH = "/settings";
const GCAL_AUTH_COOKIE_NAME = "gcal_oauth";

/** Buffer before actual expiry to avoid edge-case rejections */
const TOKEN_EXPIRY_BUFFER_MS = 60000;

// Helpers
const calendarCredentials = Effect.gen(function* () {
  return {
    clientId: yield* Config.NonEmptyString("GOOGLE_CALENDAR_CLIENT_ID"),
    clientSecret: yield* Config.Redacted("GOOGLE_CALENDAR_CLIENT_SECRET"),
  };
}).pipe(
  Effect.mapError(
    () => new HttpError({ status: 503, message: "Google Calendar OAuth is not configured" }),
  ),
);
const getRedirectUri = (rootUrl: string) => `${rootUrl}/api/admin/gcal/callback`;

type GoogleCalendarAuthState = {
  codeVerifier: string;
  redirect: string;
  state: string;
};

const getGoogleCalendarClient = Effect.fnUntraced(function* (rootUrl: string) {
  const { clientId, clientSecret } = yield* calendarCredentials;
  return new Google(clientId, Redacted.value(clientSecret), getRedirectUri(rootUrl));
});

function mapGoogleCalendarAuthError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof OAuth2RequestError) {
    return new HttpError({
      status: 400,
      message: `Google Calendar OAuth request failed (${error.code})`,
    });
  }
  if (error instanceof ArcticFetchError) {
    return new HttpError({ status: 502, message: "Google Calendar OAuth request failed" });
  }
  return new HttpError({ status: 502, message: "Google Calendar OAuth failed" });
}

// === admin_settings helpers (Effect-native) ===
/** Google Calendar integration and stored calendar settings. */
export class GoogleCalendar extends Context.Service<GoogleCalendar>()("dfg-rocks/googleCalendar", {
  make: Effect.gen(function* () {
    const rootDb = yield* PgRootDB;
    const client = yield* HttpClient.HttpClient;

    const getSettingEffect = Effect.fnUntraced(function* (key: string) {
      const row = yield* rootDb
        .execute(
          rootDb.selectFrom("app_private.admin_settings").select("value").where("key", "=", key),
        )
        .pipe(Effect.head, Effect.option);
      return Option.getOrNull(row)?.value ?? null;
    });

    const setSettingEffect = Effect.fnUntraced(function* (key: string, value: unknown) {
      yield* rootDb.execute(
        rootDb
          .insertInto("app_private.admin_settings")
          .values({ key, value: JSON.stringify(value) })
          .onConflict((oc) => oc.column("key").doUpdateSet({ value: JSON.stringify(value) })),
      );
    });

    // The stored setting is decoded on every read, so a malformed value fails as a SchemaError.
    const readWorkingHours = Effect.fnUntraced(function* () {
      const stored = yield* getSettingEffect("working_hours");
      return stored === null
        ? defaultWorkingHours
        : yield* S.decodeUnknownEffect(WorkingHours)(stored);
    });

    const deleteSettingEffect = Effect.fnUntraced(function* (key: string) {
      yield* rootDb.execute(rootDb.deleteFrom("app_private.admin_settings").where("key", "=", key));
    });

    // === Token management ===
    const getRefreshTokenEffect = Effect.fnUntraced(function* () {
      const v = yield* getSettingEffect("gcal_refresh_token");
      if (typeof v === "string") return v;
      return yield* new HttpError({ status: 400, message: "Google Calendar is not connected" });
    });

    const getCalendarIdEffect = Effect.fnUntraced(function* () {
      const v = yield* getSettingEffect("gcal_calendar_id");
      return typeof v === "string" ? v : "primary";
    });

    const getAccessTokenEffect = Effect.fnUntraced(function* () {
      const cached = yield* getSettingEffect("gcal_access_token");
      const expiresAt = yield* getSettingEffect("gcal_access_token_expires_at");
      if (
        typeof cached === "string" &&
        typeof expiresAt === "number" &&
        Date.now() < expiresAt - TOKEN_EXPIRY_BUFFER_MS
      ) {
        return cached;
      }
      const { clientId, clientSecret } = yield* calendarCredentials;
      const refreshToken = yield* getRefreshTokenEffect();
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: Redacted.value(clientSecret),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      const res = yield* client
        .post(TOKEN_URL, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: HttpBody.text(body.toString(), "application/x-www-form-urlencoded"),
        })
        .pipe(Effect.catch(() => new HttpError({ status: 502, message: "Token refresh failed" })));
      if (res.status !== 200) {
        const text = yield* res.text.pipe(Effect.orElseSucceed(() => ""));
        return yield* new HttpError({
          status: res.status,
          message: `Token refresh failed: ${text}`,
        });
      }
      const json = yield* res.json.pipe(
        Effect.catch(
          () => new HttpError({ status: 502, message: "Token refresh response was invalid" }),
        ),
      );
      const payload = yield* S.decodeUnknownEffect(RefreshTokenResponseSchema)(json).pipe(
        Effect.catchTags({
          SchemaError: () =>
            new HttpError({ status: 502, message: "Token refresh response was invalid" }),
        }),
      );
      yield* setSettingEffect("gcal_access_token", payload.access_token);
      yield* setSettingEffect(
        "gcal_access_token_expires_at",
        Date.now() + payload.expires_in * 1000,
      );
      return payload.access_token;
    });

    const gcalFetchEffect = Effect.fnUntraced(function* (
      path: string,
      options: {
        method?: "GET" | "POST" | "PATCH" | "DELETE";
        body?: unknown;
      } = {},
    ) {
      const token = yield* getAccessTokenEffect();
      const url = `${GCAL_BASE}${path}`;
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      const method = options.method ?? "GET";

      const res = yield* (
        method === "POST"
          ? client.post(url, {
              headers,
              ...(options.body !== undefined ? { body: HttpBody.jsonUnsafe(options.body) } : {}),
            })
          : method === "PATCH"
            ? client.patch(url, {
                headers,
                ...(options.body !== undefined ? { body: HttpBody.jsonUnsafe(options.body) } : {}),
              })
            : method === "DELETE"
              ? client.del(url, { headers })
              : client.get(url, { headers })
      ).pipe(
        Effect.catch(
          () => new HttpError({ status: 502, message: "Google Calendar request failed" }),
        ),
      );

      if (res.status < 200 || res.status >= 300) {
        const text = yield* res.text.pipe(Effect.orElseSucceed(() => ""));
        return yield* new HttpError({ status: res.status, message: text });
      }
      return res;
    });

    // === Available slots computation (pure) ===
    function computeAvailableSlots(
      events: GcalEvent[],
      dateStr: string,
      days: number,
      durationMinutes: number,
      workingHours: WorkingHours,
    ): TimeSlot[] {
      const slots: TimeSlot[] = [];
      const startDate = new Date(`${dateStr}T00:00:00`);
      for (let d = 0; d < days; d++) {
        const day = new Date(startDate);
        day.setDate(day.getDate() + d);
        const dow = day.getDay();
        const wh = workingHours[dow as keyof WorkingHours];
        if (!wh) continue;
        const dayStr = day.toISOString().slice(0, 10);
        const windowStart = new Date(`${dayStr}T${wh.start}:00`).getTime();
        const windowEnd = new Date(`${dayStr}T${wh.end}:00`).getTime();
        const busy: Array<{
          s: number;
          e: number;
        }> = [];
        for (const ev of events) {
          if (ev.status === "cancelled") continue;
          const evStart = ev.start.dateTime
            ? new Date(ev.start.dateTime).getTime()
            : ev.start.date
              ? new Date(ev.start.date).getTime()
              : null;
          const evEnd = ev.end.dateTime
            ? new Date(ev.end.dateTime).getTime()
            : ev.end.date
              ? new Date(ev.end.date).getTime()
              : null;
          if (evStart === null || evEnd === null) continue;
          if (evEnd <= windowStart || evStart >= windowEnd) continue;
          busy.push({
            s: Math.max(evStart, windowStart),
            e: Math.min(evEnd, windowEnd),
          });
        }
        busy.sort((a, b) => a.s - b.s);
        const durationMs = durationMinutes * 60000;
        let cursor = windowStart;
        for (const b of busy) {
          while (cursor + durationMs <= b.s) {
            slots.push({
              start: new Date(cursor),
              end: new Date(cursor + durationMs),
            });
            cursor += durationMs;
          }
          cursor = Math.max(cursor, b.e);
        }
        while (cursor + durationMs <= windowEnd) {
          slots.push({
            start: new Date(cursor),
            end: new Date(cursor + durationMs),
          });
          cursor += durationMs;
        }
      }
      return slots;
    }

    const calId = yield* getCalendarIdEffect();

    // === Core implementations (Effect-native) ===
    const listEventsEffect = Effect.fnUntraced(function* (timeMin: string, timeMax: string) {
      const all: GcalEvent[] = [];
      let pageToken: string | undefined;
      while (true) {
        const params = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "250",
        });
        if (pageToken) params.set("pageToken", pageToken);
        const res = yield* gcalFetchEffect(
          `/calendars/${encodeURIComponent(calId)}/events?${params.toString()}`,
        );
        const json = yield* res.json.pipe(
          Effect.catch(
            () =>
              new HttpError({
                status: 502,
                message: "Google Calendar events response was invalid",
              }),
          ),
        );
        const decoded = yield* S.decodeUnknownEffect(GcalEventListSchema)(json).pipe(
          Effect.catchTags({
            SchemaError: () =>
              new HttpError({
                status: 502,
                message: "Google Calendar events response was invalid",
              }),
          }),
        );
        if (decoded.items) all.push(...decoded.items);
        if (decoded.nextPageToken) {
          pageToken = decoded.nextPageToken;
        } else {
          break;
        }
      }
      return all;
    });

    return {
      getGoogleCalendarStatus: Effect.fn("getGoogleCalendarStatus")(function* () {
        const rows = yield* rootDb.execute(
          rootDb
            .selectFrom("app_private.admin_settings")
            .select(["key", "value"])
            .where("key", "in", ["gcal_refresh_token", "gcal_calendar_id"]),
        );
        const token = rows.find((r) => r.key === "gcal_refresh_token");
        const calendar = rows.find((r) => r.key === "gcal_calendar_id");
        return { connected: !!token, calendar_id: calendar?.value ?? null };
      }),
      disconnectGoogleCalendar: Effect.fn("disconnectGoogleCalendar")(function* () {
        yield* rootDb.execute(
          rootDb
            .deleteFrom("app_private.admin_settings")
            .where("key", "in", [
              "gcal_refresh_token",
              "gcal_access_token",
              "gcal_access_token_expires_at",
              "gcal_calendar_id",
              "gcal_sync_token",
            ]),
        );
      }),
      handleCallback: Effect.fnUntraced(function* (
        rootUrl: string,
        code: string,
        codeVerifier: string,
      ) {
        const gclient = yield* getGoogleCalendarClient(rootUrl);
        const tokens = yield* Effect.tryPromise({
          try: () => gclient.validateAuthorizationCode(code, codeVerifier),
          catch: (error) => mapGoogleCalendarAuthError(error),
        });
        const existingRefreshToken = yield* getSettingEffect("gcal_refresh_token");
        const refreshToken = tokens.hasRefreshToken()
          ? tokens.refreshToken()
          : typeof existingRefreshToken === "string"
            ? existingRefreshToken
            : undefined;
        if (!refreshToken) {
          return yield* new HttpError({
            status: 400,
            message: "No refresh token received. Re-authorize with prompt=consent.",
          });
        }
        yield* setSettingEffect("gcal_refresh_token", refreshToken);
        yield* setSettingEffect("gcal_access_token", tokens.accessToken());
        yield* setSettingEffect(
          "gcal_access_token_expires_at",
          tokens.accessTokenExpiresAt().getTime(),
        );
        yield* setSettingEffect("gcal_calendar_id", "primary");
      }),

      isConnected: Effect.fnUntraced(function* () {
        const v = yield* getSettingEffect("gcal_refresh_token");
        return typeof v === "string" && v.length > 0;
      }),

      disconnect: Effect.fnUntraced(function* () {
        yield* Effect.all(
          [
            deleteSettingEffect("gcal_refresh_token"),
            deleteSettingEffect("gcal_access_token"),
            deleteSettingEffect("gcal_access_token_expires_at"),
            deleteSettingEffect("gcal_sync_token"),
            deleteSettingEffect("gcal_calendar_id"),
          ],
          { concurrency: "unbounded", discard: true },
        );
      }),

      listEvents: listEventsEffect,

      createEvent: Effect.fnUntraced(function* (params: {
        id: string;
        summary: string;
        description?: string;
        start: string;
        end: string;
      }) {
        const body = {
          id: params.id,
          summary: params.summary,
          description: params.description,
          start: { dateTime: params.start },
          end: { dateTime: params.end },
        };
        const res = yield* gcalFetchEffect(`/calendars/${encodeURIComponent(calId)}/events`, {
          method: "POST",
          body,
        }).pipe(
          Effect.catchTag("HttpError", (error) =>
            error.status === 409
              ? gcalFetchEffect(
                  `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(params.id)}`,
                )
              : Effect.fail(error),
          ),
        );
        const json = yield* res.json.pipe(
          Effect.catch(
            () =>
              new HttpError({ status: 502, message: "Google Calendar event response was invalid" }),
          ),
        );
        const event = yield* S.decodeUnknownEffect(GcalEventSchema)(json).pipe(
          Effect.catchTags({
            SchemaError: () =>
              new HttpError({ status: 502, message: "Google Calendar event response was invalid" }),
          }),
        );
        if (event.id !== params.id) {
          return yield* new HttpError({
            status: 502,
            message: "Google returned an unexpected event ID",
          });
        }
        return event.id;
      }),

      deleteEvent: Effect.fnUntraced(function* (eventId: string) {
        yield* gcalFetchEffect(
          `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
          { method: "DELETE" },
        ).pipe(
          Effect.catchTag("HttpError", (error) =>
            error.status === 404 || error.status === 410 ? Effect.void : Effect.fail(error),
          ),
        );
      }),

      updateEvent: Effect.fnUntraced(function* (
        eventId: string,
        params: {
          summary?: string;
          description?: string;
          start?: string;
          end?: string;
        },
      ) {
        const body: Record<string, unknown> = {};
        if (params.summary !== undefined) body.summary = params.summary;
        if (params.description !== undefined) body.description = params.description;
        if (params.start !== undefined) body.start = { dateTime: params.start };
        if (params.end !== undefined) body.end = { dateTime: params.end };
        yield* gcalFetchEffect(
          `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
          { method: "PATCH", body },
        );
      }),

      getAvailableSlots: Effect.fnUntraced(function* (params: {
        date: string;
        days: number;
        duration: number;
      }) {
        const workingHours = yield* readWorkingHours();
        const startDate = new Date(`${params.date}T00:00:00`);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + params.days);
        const events = yield* listEventsEffect(startDate.toISOString(), endDate.toISOString());
        return computeAvailableSlots(
          events,
          params.date,
          params.days,
          params.duration,
          workingHours,
        );
      }),

      getWorkingHours: readWorkingHours,

      setWorkingHours: Effect.fnUntraced(function* (hours: WorkingHours) {
        yield* setSettingEffect("working_hours", hours);
      }),

      getSyncToken: Effect.fnUntraced(function* () {
        const v = yield* getSettingEffect("gcal_sync_token");
        return typeof v === "string" ? v : null;
      }),

      incrementalSync: Effect.fnUntraced(function* () {
        while (true) {
          const syncToken = yield* getSettingEffect("gcal_sync_token");
          if (typeof syncToken !== "string") {
            // No sync token — perform a full bootstrap sync
            const now = new Date();
            const monthAgo = new Date(now);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            const params = new URLSearchParams({
              timeMin: monthAgo.toISOString(),
              singleEvents: "true",
              maxResults: "2500",
            });
            const res = yield* gcalFetchEffect(
              `/calendars/${encodeURIComponent(calId)}/events?${params.toString()}`,
            );
            const json = yield* res.json.pipe(
              Effect.catch(
                () =>
                  new HttpError({
                    status: 502,
                    message: "Google Calendar sync response was invalid",
                  }),
              ),
            );
            const decoded = yield* S.decodeUnknownEffect(GcalChangesSchema)(json).pipe(
              Effect.catchTags({
                SchemaError: () =>
                  new HttpError({
                    status: 502,
                    message: "Google Calendar sync response was invalid",
                  }),
              }),
            );
            const nextToken = decoded.nextSyncToken ?? "";
            yield* setSettingEffect("gcal_sync_token", nextToken);
            return {
              events: decoded.items ?? [],
              nextSyncToken: nextToken,
            } as const;
          }
          // Incremental sync — must bypass gcalFetchEffect to inspect 410 before throwing
          const token = yield* getAccessTokenEffect();
          const params = new URLSearchParams({ syncToken });
          const res = yield* client
            .get(
              `${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events?${params.toString()}`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
              },
            )
            .pipe(
              Effect.catch(
                () => new HttpError({ status: 502, message: "Google Calendar request failed" }),
              ),
            );
          if (res.status === 410) {
            // Sync token expired — clear it and loop to do a full sync
            yield* deleteSettingEffect("gcal_sync_token");
            continue;
          }
          if (res.status < 200 || res.status >= 300) {
            const text = yield* res.text.pipe(Effect.orElseSucceed(() => ""));
            return yield* new HttpError({ status: res.status, message: text });
          }
          const json = yield* res.json.pipe(
            Effect.catch(
              () =>
                new HttpError({
                  status: 502,
                  message: "Google Calendar sync response was invalid",
                }),
            ),
          );
          const decoded = yield* S.decodeUnknownEffect(GcalChangesSchema)(json).pipe(
            Effect.catchTags({
              SchemaError: () =>
                new HttpError({
                  status: 502,
                  message: "Google Calendar sync response was invalid",
                }),
            }),
          );
          const nextToken = decoded.nextSyncToken ?? "";
          yield* setSettingEffect("gcal_sync_token", nextToken);
          return {
            events: decoded.items ?? [],
            nextSyncToken: nextToken,
          } as const;
        }
      }),

      createAuthorizationRequest: Effect.fn("createAuthorizationRequest")(function* (
        rootUrl: string,
      ) {
        const state = generateState();
        const codeVerifier = generateCodeVerifier();
        const gclient = yield* getGoogleCalendarClient(rootUrl);
        const url = gclient.createAuthorizationURL(state, codeVerifier, [SCOPE]);
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("prompt", "consent");
        return {
          state: {
            codeVerifier,
            redirect: CONNECT_REDIRECT_PATH,
            state,
          },
          url,
        };
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(PgRootDB.layer));

  // Sync helpers — no I/O needed
  static getAuthCookieName(): string {
    return GCAL_AUTH_COOKIE_NAME;
  }

  static getConnectRedirectUrl(rootUrl: string, redirectPath = CONNECT_REDIRECT_PATH): string {
    return new URL(redirectPath, rootUrl).toString();
  }

  static encodeAuthState(value: GoogleCalendarAuthState): string {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  }

  static decodeAuthState(value: unknown) {
    if (typeof value !== "string" || !value) return Effect.succeed(null);

    return S.decodeEffect(S.fromJsonString(GoogleCalendarAuthStateSchema))(
      Buffer.from(value, "base64url").toString("utf8"),
    ).pipe(Effect.orElseSucceed(() => null));
  }

  static getAuthCookieOptions = Effect.fnUntraced(function* (rootUrl: string) {
    const isProduction = (yield* Config.String("NODE_ENV")) === "production";
    const root = new URL(rootUrl);
    return {
      httpOnly: true,
      maxAge: Duration.minutes(10),
      path: "/api/admin/gcal",
      sameSite: "lax" as const,
      secure: isProduction || root.protocol === "https:",
    };
  });
}
