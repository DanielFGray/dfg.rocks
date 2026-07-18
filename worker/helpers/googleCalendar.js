// @ts-check

const GCAL_BASE = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

/**
 * Google permits caller-supplied event IDs using base32hex characters. UUID
 * hexadecimal digits are already in that alphabet, making this stable across retries.
 * @param {string} lessonId
 */
export function eventIdForLesson(lessonId) {
  const hexadecimal = lessonId.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hexadecimal)) {
    throw new Error(`Invalid lesson UUID: ${lessonId}`);
  }
  return `df9${hexadecimal}`;
}

/** @param {unknown} value */
function jsonbString(value) {
  return typeof value === "string" ? value : null;
}

/**
 * @param {import("pg").PoolClient} pgClient
 * @param {typeof fetch} fetchImpl
 */
async function getAccessToken(pgClient, fetchImpl) {
  const { rows } = await pgClient.query(
    `select key, value
       from app_private.admin_settings
      where key in ('gcal_access_token', 'gcal_access_token_expires_at', 'gcal_refresh_token')`,
  );
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  if (
    typeof settings.gcal_access_token === "string" &&
    typeof settings.gcal_access_token_expires_at === "number" &&
    settings.gcal_access_token_expires_at > Date.now() + TOKEN_EXPIRY_BUFFER_MS
  ) {
    return settings.gcal_access_token;
  }

  const refreshToken = jsonbString(settings.gcal_refresh_token);
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!refreshToken) throw new Error("Google Calendar is not connected");
  if (!clientId || !clientSecret) throw new Error("Google Calendar OAuth is not configured");

  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google token refresh failed (${response.status}): ${detail}`);
  }

  const tokens = /** @type {{ access_token?: unknown, expires_in?: unknown }} */ (
    await response.json()
  );
  if (typeof tokens.access_token !== "string" || typeof tokens.expires_in !== "number") {
    throw new Error("Google token refresh returned an invalid response");
  }

  const expiresAt = Date.now() + tokens.expires_in * 1000;
  await pgClient.query(
    `insert into app_private.admin_settings (key, value)
     values ('gcal_access_token', $1::jsonb),
            ('gcal_access_token_expires_at', $2::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [JSON.stringify(tokens.access_token), JSON.stringify(expiresAt)],
  );
  return tokens.access_token;
}

/**
 * @param {object} input
 * @param {import("pg").PoolClient} input.pgClient
 * @param {{ id: string, student_name: string | null, scheduled_at: Date | string, duration_minutes: number, location_type: string }} input.lesson
 * @param {typeof fetch} [input.fetchImpl]
 */
export async function ensureLessonEvent({ pgClient, lesson, fetchImpl = fetch }) {
  const token = await getAccessToken(pgClient, fetchImpl);
  const {
    rows: [calendarRow],
  } = await pgClient.query(
    `select value from app_private.admin_settings where key = 'gcal_calendar_id'`,
  );
  const calendarId = jsonbString(calendarRow?.value) ?? "primary";
  const eventId = eventIdForLesson(lesson.id);
  const eventPath = `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const start = new Date(lesson.scheduled_at);
  const end = new Date(start.getTime() + lesson.duration_minutes * 60_000);
  const body = {
    id: eventId,
    summary: `Lesson: ${lesson.student_name ?? "Student"}`,
    description: `${lesson.duration_minutes} min ${lesson.location_type.replaceAll("_", " ")} lesson`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };

  const response = await fetchImpl(
    `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (response.status === 409) {
    const existing = await fetchImpl(`${GCAL_BASE}${eventPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!existing.ok) {
      const detail = await existing.text().catch(() => "");
      throw new Error(
        `Google event conflict could not be confirmed (${existing.status}): ${detail}`,
      );
    }
    const event = /** @type {{ id?: unknown }} */ (await existing.json());
    if (event.id !== eventId) throw new Error("Google returned an unexpected existing event ID");
    return eventId;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google event creation failed (${response.status}): ${detail}`);
  }
  const event = /** @type {{ id?: unknown }} */ (await response.json());
  if (event.id !== eventId) throw new Error("Google returned an unexpected event ID");
  return eventId;
}
