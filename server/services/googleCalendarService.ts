import {
  ArcticFetchError,
  Google,
  OAuth2RequestError,
  generateCodeVerifier,
  generateState,
} from "arctic";
import { rootDb } from "../db.js";
import { env } from "../assertEnv.js";
import { HttpError } from "../pgErrors.js";
import { parseWith, WorkingHours as WorkingHoursSchema } from "../../shared/validation.js";

// === Types ===

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

interface GcalEventList {
  items?: GcalEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface TimeSlot {
  start: string; // ISO datetime
  end: string; // ISO datetime
}

export interface WorkingHours {
  [dayOfWeek: number]: { start: string; end: string } | null; // 0=Sunday..6=Saturday, null = not working
}

const defaultWorkingHours: WorkingHours = {
  0: null,
  1: { start: "09:00", end: "20:00" },
  2: { start: "09:00", end: "20:00" },
  3: { start: "09:00", end: "20:00" },
  4: { start: "09:00", end: "20:00" },
  5: { start: "09:00", end: "20:00" },
  6: { start: "10:00", end: "14:00" },
};

// === Constants ===

const GCAL_BASE = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CONNECT_REDIRECT_PATH = "/settings";
const GCAL_AUTH_COOKIE_NAME = "gcal_oauth";

/** Buffer before actual expiry to avoid edge-case rejections */
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

// === Helpers ===

const getClientId = () => env.GOOGLE_CALENDAR_CLIENT_ID ?? "";
const getClientSecret = () => env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "";
const getRedirectUri = (rootUrl: string) => `${rootUrl}/api/admin/gcal/callback`;

type GoogleCalendarAuthState = {
  codeVerifier: string;
  redirect: string;
  state: string;
};

function getGoogleCalendarClient(rootUrl: string): Google {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret) {
    throw new HttpError(503, "Google Calendar OAuth is not configured");
  }

  return new Google(clientId, clientSecret, getRedirectUri(rootUrl));
}

function encodeAuthState(value: GoogleCalendarAuthState): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeAuthState(value: unknown): GoogleCalendarAuthState | null {
  if (typeof value !== "string" || !value) return null;

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      codeVerifier?: unknown;
      redirect?: unknown;
      state?: unknown;
    };
    if (
      typeof parsed.codeVerifier !== "string" ||
      typeof parsed.redirect !== "string" ||
      typeof parsed.state !== "string"
    ) {
      return null;
    }

    return {
      codeVerifier: parsed.codeVerifier,
      redirect: parsed.redirect,
      state: parsed.state,
    };
  } catch {
    return null;
  }
}

function getConnectRedirectUrl(rootUrl: string, redirectPath = CONNECT_REDIRECT_PATH): string {
  return new URL(redirectPath, rootUrl).toString();
}

function mapGoogleCalendarAuthError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof OAuth2RequestError) {
    return new HttpError(400, `Google Calendar OAuth request failed (${error.code})`);
  }
  if (error instanceof ArcticFetchError) {
    return new HttpError(502, "Google Calendar OAuth request failed");
  }
  return new HttpError(502, "Google Calendar OAuth failed");
}

// ---- admin_settings helpers ----

async function getSetting(key: string): Promise<unknown> {
  const row = await rootDb
    .selectFrom("app_private.admin_settings")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();
  return row ? row.value : null;
}

async function setSetting(key: string, value: unknown): Promise<void> {
  await rootDb
    .insertInto("app_private.admin_settings")
    .values({ key, value: JSON.stringify(value) })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: JSON.stringify(value) }))
    .execute();
}

async function deleteSetting(key: string): Promise<void> {
  await rootDb.deleteFrom("app_private.admin_settings").where("key", "=", key).execute();
}

// ---- token management ----

async function getRefreshToken(): Promise<string> {
  const v = await getSetting("gcal_refresh_token");
  if (typeof v === "string") return v;
  throw new HttpError(400, "Google Calendar is not connected");
}

async function getCalendarId(): Promise<string> {
  const v = await getSetting("gcal_calendar_id");
  return typeof v === "string" ? v : "primary";
}

async function getAccessToken(): Promise<string> {
  const cached = await getSetting("gcal_access_token");
  const expiresAt = await getSetting("gcal_access_token_expires_at");

  if (
    typeof cached === "string" &&
    typeof expiresAt === "number" &&
    Date.now() < expiresAt - TOKEN_EXPIRY_BUFFER_MS
  ) {
    return cached;
  }

  // refresh
  if (!getClientId() || !getClientSecret()) {
    throw new HttpError(503, "Google Calendar OAuth is not configured");
  }
  const refreshToken = await getRefreshToken();
  const body = new URLSearchParams({
    client_id: getClientId(),
    client_secret: getClientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(res.status, `Token refresh failed: ${text}`);
  }

  const json = await res.json();

  const newToken = json.access_token;
  const newExpiry = Date.now() + json.expires_in * 1000;

  if (typeof newToken !== "string" || typeof json.expires_in !== "number") {
    throw new HttpError(502, "Token refresh response was invalid");
  }

  await setSetting("gcal_access_token", newToken);
  await setSetting("gcal_access_token_expires_at", newExpiry);

  return newToken;
}

// ---- gcal REST helper ----

async function gcalFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${GCAL_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(res.status, text);
  }

  return res;
}

// ---- available slots computation ----

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
    const wh = workingHours[dow];
    if (!wh) continue;

    const dayStr = day.toISOString().slice(0, 10);
    const windowStart = new Date(`${dayStr}T${wh.start}:00`).getTime();
    const windowEnd = new Date(`${dayStr}T${wh.end}:00`).getTime();

    // collect busy intervals for this day
    const busy: Array<{ s: number; e: number }> = [];
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

    const durationMs = durationMinutes * 60_000;
    let cursor = windowStart;
    for (const b of busy) {
      while (cursor + durationMs <= b.s) {
        slots.push({
          start: new Date(cursor).toISOString(),
          end: new Date(cursor + durationMs).toISOString(),
        });
        cursor += durationMs;
      }
      cursor = Math.max(cursor, b.e);
    }

    while (cursor + durationMs <= windowEnd) {
      slots.push({
        start: new Date(cursor).toISOString(),
        end: new Date(cursor + durationMs).toISOString(),
      });
      cursor += durationMs;
    }
  }

  return slots;
}

// ---- internal implementations ----

async function listEventsImpl(timeMin: string, timeMax: string): Promise<GcalEvent[]> {
  const calId = await getCalendarId();
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

    const res = await gcalFetch(
      `/calendars/${encodeURIComponent(calId)}/events?${params.toString()}`,
    );
    const decoded = await res.json();

    if (decoded.items) all.push(...decoded.items);
    if (decoded.nextPageToken) {
      pageToken = decoded.nextPageToken;
    } else {
      break;
    }
  }

  return all;
}

async function incrementalSyncImpl(): Promise<{
  events: readonly GcalEvent[];
  nextSyncToken: string;
}> {
  const calId = await getCalendarId();
  const syncToken = await getSetting("gcal_sync_token");

  // no sync token => full sync to bootstrap one
  if (typeof syncToken !== "string") {
    const now = new Date();
    const monthAgo = new Date(now);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const params = new URLSearchParams({
      timeMin: monthAgo.toISOString(),
      singleEvents: "true",
      maxResults: "2500",
    });

    const res = await gcalFetch(
      `/calendars/${encodeURIComponent(calId)}/events?${params.toString()}`,
    );
    const decoded = await res.json();

    const nextToken = decoded.nextSyncToken ?? "";
    await setSetting("gcal_sync_token", nextToken);
    return { events: decoded.items ?? [], nextSyncToken: nextToken };
  }

  // incremental sync with existing token
  const token = await getAccessToken();
  const params = new URLSearchParams({ syncToken });
  const res = await fetch(
    `${GCAL_BASE}/calendars/${encodeURIComponent(calId)}/events?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );

  // 410 Gone = sync token expired, clear and do full sync
  if (res.status === 410) {
    await deleteSetting("gcal_sync_token");
    return incrementalSyncImpl();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(res.status, text);
  }

  const decoded = await res.json();

  const nextToken = decoded.nextSyncToken ?? "";
  await setSetting("gcal_sync_token", nextToken);
  return { events: decoded.items ?? [], nextSyncToken: nextToken };
}

// ---- public service interface ----

export const googleCalendarService = {
  createAuthorizationRequest(rootUrl: string) {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = getGoogleCalendarClient(rootUrl).createAuthorizationURL(state, codeVerifier, [
      SCOPE,
    ]);
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
  },

  decodeAuthState,

  encodeAuthState,

  getAuthCookieName() {
    return GCAL_AUTH_COOKIE_NAME;
  },

  getAuthCookieOptions(rootUrl: string) {
    const root = new URL(rootUrl);
    return {
      httpOnly: true,
      maxAge: 60 * 10,
      path: "/api/admin/gcal",
      sameSite: "lax" as const,
      secure: env.NODE_ENV === "production" || root.protocol === "https:",
    };
  },

  getConnectRedirectUrl,

  async handleCallback(rootUrl: string, code: string, codeVerifier: string) {
    let tokens;
    try {
      tokens = await getGoogleCalendarClient(rootUrl).validateAuthorizationCode(
        code,
        codeVerifier,
      );
    } catch (error) {
      throw mapGoogleCalendarAuthError(error);
    }

    const existingRefreshToken = await getSetting("gcal_refresh_token");
    const refreshToken = tokens.hasRefreshToken()
      ? tokens.refreshToken()
      : typeof existingRefreshToken === "string"
        ? existingRefreshToken
        : undefined;

    if (!refreshToken) {
      throw new HttpError(400, "No refresh token received. Re-authorize with prompt=consent.");
    }

    await setSetting("gcal_refresh_token", refreshToken);
    await setSetting("gcal_access_token", tokens.accessToken());
    await setSetting("gcal_access_token_expires_at", tokens.accessTokenExpiresAt().getTime());
    await setSetting("gcal_calendar_id", "primary");
  },

  async isConnected() {
    const v = await getSetting("gcal_refresh_token");
    return typeof v === "string" && v.length > 0;
  },

  async disconnect() {
    await Promise.all([
      deleteSetting("gcal_refresh_token"),
      deleteSetting("gcal_access_token"),
      deleteSetting("gcal_access_token_expires_at"),
      deleteSetting("gcal_sync_token"),
      deleteSetting("gcal_calendar_id"),
    ]);
  },

  listEvents: listEventsImpl,

  async createEvent(params: { summary: string; description?: string; start: string; end: string }) {
    const calId = await getCalendarId();
    const body = {
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.start },
      end: { dateTime: params.end },
    };

    const res = await gcalFetch(`/calendars/${encodeURIComponent(calId)}/events`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const json = await res.json();
    return json.id;
  },

  async deleteEvent(eventId: string) {
    const calId = await getCalendarId();
    await gcalFetch(
      `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
  },

  async updateEvent(
    eventId: string,
    params: {
      summary?: string;
      description?: string;
      start?: string;
      end?: string;
    },
  ) {
    const calId = await getCalendarId();
    const body: Record<string, unknown> = {};
    if (params.summary !== undefined) body.summary = params.summary;
    if (params.description !== undefined) body.description = params.description;
    if (params.start !== undefined) body.start = { dateTime: params.start };
    if (params.end !== undefined) body.end = { dateTime: params.end };

    await gcalFetch(
      `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },

  async getAvailableSlots(params: { date: string; days: number; duration: number }) {
    const wh = await getSetting("working_hours");
    const workingHours = wh ? parseWith(WorkingHoursSchema, wh) : defaultWorkingHours;

    const startDate = new Date(`${params.date}T00:00:00`);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + params.days);

    const events = await listEventsImpl(startDate.toISOString(), endDate.toISOString());

    return computeAvailableSlots(events, params.date, params.days, params.duration, workingHours);
  },

  async getWorkingHours() {
    const v = await getSetting("working_hours");
    return v ? parseWith(WorkingHoursSchema, v) : defaultWorkingHours;
  },

  setWorkingHours: (hours: WorkingHours) => setSetting("working_hours", hours),

  async getSyncToken() {
    const v = await getSetting("gcal_sync_token");
    return typeof v === "string" ? v : null;
  },

  incrementalSync: incrementalSyncImpl,
} as const;
