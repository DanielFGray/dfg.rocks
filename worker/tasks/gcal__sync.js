// @ts-check
/** @typedef {import("graphile-worker").Task} Task */

/**
 * Polls Google Calendar for teacher-initiated changes (event moves, cancellations)
 * and syncs them back to the lessons table.
 *
 * Self-reschedules every 3 minutes via jobKey replace.
 *
 * Uses incremental sync (syncToken) when available; falls back to full sync
 * (last 30 days) when no token or token expired (410 Gone).
 */

const SYNC_INTERVAL_MS = 3 * 60_000;
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const GCAL_BASE = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** @type {Task} */
export default async (_payload, helpers) => {
  const { withPgClient, logger, addJob } = helpers;

  try {
    await withPgClient(async (pgClient) => {
      // Check if gcal is connected
      const {
        rows: [tokenRow],
      } = await pgClient.query(
        `select value from app_private.admin_settings where key = 'gcal_refresh_token'`,
      );
      if (!tokenRow) {
        logger.info("gcal__sync: not connected, skipping");
        return;
      }

      const accessToken = await getValidAccessToken(pgClient, logger);
      if (!accessToken) return;

      // Get calendar ID (default "primary")
      const {
        rows: [calRow],
      } = await pgClient.query(
        `select value from app_private.admin_settings where key = 'gcal_calendar_id'`,
      );
      const calendarId = calRow?.value ? parseJsonbString(calRow.value) : "primary";

      // Get sync token
      const {
        rows: [syncRow],
      } = await pgClient.query(
        `select value from app_private.admin_settings where key = 'gcal_sync_token'`,
      );
      const syncToken = syncRow?.value ? parseJsonbString(syncRow.value) : null;

      // Build request URL
      /** @type {string} */
      let url;
      if (syncToken) {
        const params = new URLSearchParams({ syncToken });
        url = `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
      } else {
        // Full sync: last 30 days
        const timeMin = new Date(Date.now() - 30 * 86_400_000).toISOString();
        const params = new URLSearchParams({
          timeMin,
          singleEvents: "true",
          maxResults: "2500",
        });
        url = `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      // 410 Gone = sync token expired, clear and let next run do full sync
      if (res.status === 410) {
        logger.info("gcal__sync: sync token expired, clearing for full sync on next run");
        await pgClient.query(
          `delete from app_private.admin_settings where key = 'gcal_sync_token'`,
        );
        return;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "(unreadable)");
        logger.error(`gcal__sync: API error ${res.status}: ${text}`);
        return;
      }

      const data = /** @type {{ items?: Array<any>, nextSyncToken?: string }} */ (
        await res.json()
      );
      const events = data.items || [];
      const nextSyncToken = data.nextSyncToken;

      // Process changed events
      let processed = 0;
      for (const event of events) {
        if (!event.id) continue;

        // Find matching lesson by gcal_event_id
        const {
          rows: [lesson],
        } = await pgClient.query(
          `select id, status from app_public.lessons where gcal_event_id = $1`,
          [event.id],
        );

        if (!lesson) continue; // Not a lesson we track

        if (event.status === "cancelled") {
          // Event deleted/cancelled in gcal
          if (lesson.status === "scheduled") {
            logger.info(
              `gcal__sync: cancelling lesson ${lesson.id} (gcal event ${event.id} cancelled)`,
            );
            await pgClient.query(
              `update app_public.lessons
               set status = 'cancelled',
                   cancelled_at = now(),
                   cancellation_reason = 'Cancelled from Google Calendar'
               where id = $1`,
              [lesson.id],
            );
            processed++;
          }
        } else if (event.start?.dateTime) {
          // Event moved — update cached scheduled_at
          const newStart = new Date(event.start.dateTime);
          await pgClient.query(
            `update app_public.lessons set scheduled_at = $1 where id = $2`,
            [newStart, lesson.id],
          );
          processed++;
        }
      }

      // Store new sync token
      if (nextSyncToken) {
        await pgClient.query(
          `insert into app_private.admin_settings (key, value)
           values ('gcal_sync_token', $1::jsonb)
           on conflict (key) do update set value = $1::jsonb`,
          [JSON.stringify(nextSyncToken)],
        );
      }

      logger.info(
        `gcal__sync: fetched ${events.length} events, processed ${processed} changes`,
      );
    });
  } catch (err) {
    logger.error(`gcal__sync: unexpected error: ${err}`);
  }

  // Always reschedule, even on error
  await addJob("gcal__sync", {}, {
    runAt: new Date(Date.now() + SYNC_INTERVAL_MS),
    queueName: "gcal",
    maxAttempts: 1,
    jobKey: "gcal__sync",
    jobKeyMode: "replace",
  });
};

// === helpers ===

/**
 * Parse a jsonb value that was stored as a JSON-encoded string.
 * admin_settings stores values via JSON.stringify(), so a string "foo"
 * is stored as the jsonb value `"foo"` (with quotes). pg returns it
 * already parsed, so we just need to handle both cases.
 * @param {unknown} val
 * @returns {string | null}
 */
function parseJsonbString(val) {
  if (typeof val === "string") return val;
  return null;
}

/**
 * Get a valid access token, refreshing via the stored refresh token if needed.
 * @param {import("pg").PoolClient} pgClient
 * @param {import("graphile-worker").Logger} logger
 * @returns {Promise<string | null>}
 */
async function getValidAccessToken(pgClient, logger) {
  const {
    rows: [atRow],
  } = await pgClient.query(
    `select value from app_private.admin_settings where key = 'gcal_access_token'`,
  );
  const {
    rows: [expRow],
  } = await pgClient.query(
    `select value from app_private.admin_settings where key = 'gcal_access_token_expires_at'`,
  );

  const accessToken = atRow?.value;
  const expiresAt = expRow?.value;

  // If token still valid (with buffer), use it
  if (
    typeof accessToken === "string" &&
    typeof expiresAt === "number" &&
    expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS
  ) {
    return accessToken;
  }

  // Need to refresh
  const {
    rows: [rtRow],
  } = await pgClient.query(
    `select value from app_private.admin_settings where key = 'gcal_refresh_token'`,
  );
  if (!rtRow?.value) return null;
  const refreshToken = /** @type {string} */ (rtRow.value);

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    logger.error(
      "gcal__sync: missing GOOGLE_CALENDAR_CLIENT_ID or GOOGLE_CALENDAR_CLIENT_SECRET",
    );
    return null;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable)");
    logger.error(`gcal__sync: token refresh failed ${res.status}: ${text}`);
    return null;
  }

  const tokens = /** @type {{ access_token: string, expires_in: number }} */ (
    await res.json()
  );

  // Store refreshed tokens (matching googleCalendarService.ts storage format)
  await pgClient.query(
    `insert into app_private.admin_settings (key, value)
     values ('gcal_access_token', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb`,
    [JSON.stringify(tokens.access_token)],
  );

  const newExpiry = Date.now() + tokens.expires_in * 1000;
  await pgClient.query(
    `insert into app_private.admin_settings (key, value)
     values ('gcal_access_token_expires_at', $1::jsonb)
     on conflict (key) do update set value = $1::jsonb`,
    [JSON.stringify(newExpiry)],
  );

  return tokens.access_token;
}
