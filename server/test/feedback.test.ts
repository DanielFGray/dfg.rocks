// @entrypoint: the test bridges vitest callbacks to the runtime and the /api handler.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Logger, ManagedRuntime } from "effect";
import { CurrentLogAnnotations } from "effect/References";
import * as HttpRouter from "effect/http/HttpRouter";
import { sql } from "kysely";
import { applicationLayer, HttpApiLive, type ApplicationServices } from "../runtime.js";
import { PgRootDB } from "../db.js";
import { Sessions } from "../services/sessions.js";
import { Worker } from "../../worker/worker.js";

/** One log event as the OTLP exporter would see it: its message and its annotations. */
type CapturedLog = {
  message: unknown;
  annotations: Record<string, unknown>;
};

const capturedLogs: Array<CapturedLog> = [];

// The OTLP exporter builds each log record's attributes from the fiber's log
// annotations (OtlpLogger does the same read), so capturing them here is what
// OpenObserve receives as attributes.
const captureLogger = Logger.make<unknown, void>((options) => {
  capturedLogs.push({
    message: options.message,
    annotations: { ...options.fiber.getRef(CurrentLogAnnotations) },
  });
});

/** The feedback records: only the logs the endpoint marks as feedback. */
const feedbackRecords = () => capturedLogs.filter((log) => log.annotations["feedback"] === true);

const testServices = applicationLayer.pipe(
  Layer.provideMerge(Layer.succeed(Worker, { isRunning: Effect.succeed(true) })),
  // Replaces every other logger, so `capturedLogs` holds exactly what OTLP exports.
  Layer.provideMerge(Logger.layer([captureLogger])),
);

// One memo map, so the handler and the runtime share one set of services and pools.
const memoMap = Layer.makeMemoMapUnsafe();
const testRuntime = ManagedRuntime.make(testServices, { memoMap });

const run = <A, E>(
  effect: Effect.Effect<A, E, ApplicationServices>,
): Promise<A> => testRuntime.runPromise(effect);

const web = HttpRouter.toWebHandler(HttpApiLive.pipe(Layer.provideMerge(testServices)), {
  memoMap,
  disableLogger: true,
});

const runId = Math.random().toString(36).slice(2, 8);

const submission = (overrides: Record<string, unknown> = {}) => ({
  message: "The calendar is hard to read",
  category: "bug" as const,
  page_url: "https://dfg.rocks/dashboard",
  app_version: "0.2.0",
  ...overrides,
});

const post = (payload: unknown, headers: Record<string, string> = {}) =>
  web.handler(
    new Request("http://dfg.test/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "dfg", ...headers },
      body: JSON.stringify(payload),
    }),
  );

/** The one feedback record whose message names this test; fails when it is missing or duplicated. */
const recordFor = (message: string) => {
  const matches = feedbackRecords().filter(
    (log) => log.annotations["feedback.message"] === message,
  );
  expect(matches).toHaveLength(1);
  return matches[0].annotations;
};

const noRecordFor = (message: string) => {
  expect(
    feedbackRecords().filter((log) => log.annotations["feedback.message"] === message),
  ).toHaveLength(0);
};

describe("feedback endpoint", () => {
  it("logs one feedback record with the submission's fields", async () => {
    const response = await post(
      submission({ message: "The calendar is hard to read" }),
    );
    expect(response.status).toBe(200);
    expect(recordFor("The calendar is hard to read")).toMatchObject({
      "feedback.category": "bug",
      "feedback.page_url": "https://dfg.rocks/dashboard",
      "feedback.app_version": "0.2.0",
    });
    // A signed-out visitor's record names no user, and no contact when they gave none.
    expect(recordFor("The calendar is hard to read")["feedback.user_id"]).toBeUndefined();
    expect(recordFor("The calendar is hard to read")["feedback.contact"]).toBeUndefined();
  });

  // The client strips the URL too; the server strips again, so a token in the query
  // or fragment never reaches the log even when the client is not trusted.
  it("strips the query string and fragment from the logged page URL", async () => {
    const token = `fb_secret_token_${runId}`;
    const response = await post(
      submission({
        message: "The reset link lost its token",
        page_url: `https://dfg.rocks/reset-password?token=${token}#top`,
      }),
    );
    expect(response.status).toBe(200);
    const annotations = recordFor("The reset link lost its token");
    expect(annotations["feedback.page_url"]).toBe("https://dfg.rocks/reset-password");
    expect(JSON.stringify(annotations)).not.toContain(token);
  });

  it("attaches the signed-in user's id from the session", async () => {
    const { userId, token } = await run(
      Effect.gen(function* () {
        const rootDb = yield* PgRootDB;
        const created = yield* rootDb.execute(
          rootDb
            .selectFrom(
              sql<{ id: string }>`
                app_private.really_create_user(
                  ${`fb_user_${runId}`}::citext,
                  'Feedback User',
                  null,
                  true,
                  ${`fb_user_${runId}@test.dfg.rocks`}::citext,
                  'feedback-password'
                )`.as("u"),
            )
            .select("id"),
        );
        const sessions = yield* Sessions;
        return { userId: created[0].id, token: (yield* sessions.createSession(created[0].id)).token };
      }),
    );
    const response = await post(
      submission({ message: "Signed-in feedback" }),
      { cookie: `session=${token}` },
    );
    expect(response.status).toBe(200);
    // The id comes from the session cookie, never from the payload.
    expect(recordFor("Signed-in feedback")["feedback.user_id"]).toBe(userId);
  });

  it("carries the contact field only when the visitor gave one", async () => {
    const response = await post(
      submission({ message: "Reply to me", contact: "feedback-visitor@example.com" }),
    );
    expect(response.status).toBe(200);
    expect(recordFor("Reply to me")["feedback.contact"]).toBe("feedback-visitor@example.com");
  });

  it("refuses a filled honeypot field without a feedback record", async () => {
    const response = await post(
      submission({ message: "A bot wrote this", website: "https://spam.example" }),
    );
    expect(response.status).toBe(400);
    noRecordFor("A bot wrote this");
  });

  it("rejects a submission without a message", async () => {
    const response = await post(submission({ message: "" }));
    expect(response.status).toBe(400);
    noRecordFor("");
  });

  it("rejects an unknown category", async () => {
    const response = await post(
      submission({ message: "Praise for once", category: "praise" }),
    );
    expect(response.status).toBe(400);
    noRecordFor("Praise for once");
  });
});
