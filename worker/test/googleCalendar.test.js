import { afterEach, describe, expect, test } from "bun:test";
import { ensureLessonEvent, eventIdForLesson } from "../helpers/googleCalendar.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("Google Calendar lesson projection", () => {
  test("derives a stable Google-compatible ID from the lesson UUID", () => {
    expect(eventIdForLesson("123e4567-e89b-12d3-a456-426614174000")).toBe(
      "df9123e4567e89b12d3a456426614174000",
    );
    expect(() => eventIdForLesson("not-a-uuid")).toThrow("Invalid lesson UUID");
  });

  test("confirms a 409 conflict and returns the deterministic ID", async () => {
    const lessonId = "123e4567-e89b-12d3-a456-426614174000";
    const eventId = eventIdForLesson(lessonId);
    const requests = [];
    const pgClient = {
      query: async (sql) => {
        if (sql.includes("where key in")) {
          return {
            rows: [
              { key: "gcal_access_token", value: "cached-token" },
              { key: "gcal_access_token_expires_at", value: Date.now() + 300_000 },
            ],
          };
        }
        if (sql.includes("gcal_calendar_id")) return { rows: [{ value: "primary" }] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    };
    const fetchImpl = async (url, init = {}) => {
      requests.push({ url: String(url), method: init.method ?? "GET" });
      if (init.method === "POST") return new Response("", { status: 409 });
      return Response.json({ id: eventId });
    };

    await expect(
      ensureLessonEvent({
        pgClient,
        fetchImpl,
        lesson: {
          id: lessonId,
          student_name: "Ada",
          scheduled_at: "2026-07-14T15:00:00.000Z",
          duration_minutes: 60,
          location_type: "online",
        },
      }),
    ).resolves.toBe(eventId);
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toEndWith(`/events/${eventId}`);
  });

  test("throws API failures so Graphile Worker retries", async () => {
    const pgClient = {
      query: async (sql) =>
        sql.includes("where key in")
          ? {
              rows: [
                { key: "gcal_access_token", value: "cached-token" },
                { key: "gcal_access_token_expires_at", value: Date.now() + 300_000 },
              ],
            }
          : { rows: [] },
    };
    await expect(
      ensureLessonEvent({
        pgClient,
        fetchImpl: async () => new Response("quota", { status: 503 }),
        lesson: {
          id: "123e4567-e89b-12d3-a456-426614174000",
          student_name: null,
          scheduled_at: "2026-07-14T15:00:00.000Z",
          duration_minutes: 30,
          location_type: "studio",
        },
      }),
    ).rejects.toThrow("Google event creation failed (503)");
  });
});
