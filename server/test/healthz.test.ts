import { afterEach, describe, expect, it, vi } from "vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Etag from "effect/http/Etag";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import type * as SqlClient from "effect/sql/SqlClient";
import { ConnectionError, SqlError } from "effect/sql/SqlError";
import { Database, PgAuthDB } from "../db.js";
import { BackgroundWorker } from "../services/backgroundWorker.js";
import { healthApi, makeHealthLayer } from "../api/health.js";

// Serves /healthz through the real HttpApi layer. The database is a stub client: `Database.execute`
// reaches only `unsafe`, so the stub answers that one call. The worker stub reports only `failed`.
function healthHandler(unsafe: (...args: never[]) => unknown, workerFailed = false) {
  const database = new Database({ unsafe } as unknown as SqlClient.SqlClient);
  const worker = { failed: Effect.succeed(workerFailed) };
  const layer = HttpApiBuilder.layer(healthApi).pipe(
    Layer.provide(makeHealthLayer()),
    Layer.provide(
      Layer.mergeAll(NodeFileSystem.layer, NodeHttpPlatform.layer, NodePath.layer, Etag.layer),
    ),
  );
  const { handler } = HttpRouter.toWebHandler(layer, { disableLogger: true });
  const services = Context.make(PgAuthDB, database).pipe(Context.add(BackgroundWorker, worker));
  return (request: Request) => handler(request, services);
}

const healthRequest = () => new Request("http://localhost/healthz");

describe("GET /healthz", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 200 with the commit when the database answers", async () => {
    vi.stubEnv("GIT_COMMIT", "3f9c2ab");
    const handler = healthHandler(() => Effect.succeed([{ one: 1 }]));

    const response = await handler(healthRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", commit: "3f9c2ab" });
  });

  it("answers 503 naming the database when the database is unreachable", async () => {
    vi.stubEnv("GIT_COMMIT", "3f9c2ab");
    const handler = healthHandler(() =>
      Effect.fail(
        new SqlError({
          reason: new ConnectionError({ cause: new Error("connection refused") }),
        }),
      ),
    );

    const response = await handler(healthRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      commit: "3f9c2ab",
      failed: ["database"],
    });
  });

  it("answers 503 naming the worker when the worker runner has stopped", async () => {
    vi.stubEnv("GIT_COMMIT", "3f9c2ab");
    const handler = healthHandler(() => Effect.succeed([{ one: 1 }]), true);

    const response = await handler(healthRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      commit: "3f9c2ab",
      failed: ["worker"],
    });
  });
});
