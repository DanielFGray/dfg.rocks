import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { NodeServices } from "@effect/platform-node";
import { PgRootDB } from "../db.js";
import { BackgroundWorker } from "../services/backgroundWorker.js";
import { GoogleCalendar } from "../services/googleCalendar.js";

it.effect("fails the layer when the worker runner cannot start", () =>
  Effect.gen(function* () {
    const rootDatabase = PgRootDB.layer.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            DATABASE_URL: "postgres://worker:worker@127.0.0.1:1/unavailable",
          }),
        ),
      ),
    );
    const worker = BackgroundWorker.layer.pipe(
      Layer.provideMerge(rootDatabase),
      Layer.provide(NodeServices.layer),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(
        GoogleCalendar.layer.pipe(
          Layer.provide(rootDatabase),
          Layer.provide(FetchHttpClient.layer),
        ),
      ),
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            DATABASE_URL: "postgres://worker:worker@127.0.0.1:1/unavailable",
            NODE_ENV: "test",
            MAIL_PROVIDER: "capture",
          }),
        ),
      ),
    );
    const result = yield* Effect.exit(Effect.scoped(Layer.build(worker)));
    expect(result._tag).toBe("Failure");
  }),
);
