import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import { applicationLayer, HttpApiLive } from "./runtime.js";
import { BackgroundWorker } from "./services/backgroundWorker.js";

/**
 * Builds the application in the current scope: the services, the job runner and the /api handler.
 * The process shell (server/main.ts, server/dev.ts) serves `api`, and hands `services` to the pages.
 *
 * The runner is built after the services, so closing the scope stops it before the database pools
 * close.
 */
export const makeApp = Effect.fnUntraced(function* (workerDirectory: string) {
  const services = yield* Layer.build(
    BackgroundWorker.layer(workerDirectory).pipe(Layer.provideMerge(applicationLayer)),
  );
  const api = yield* HttpRouter.toHttpEffect(HttpApiLive).pipe(Effect.provideContext(services));
  return { api: api.pipe(Effect.provideContext(services)), services };
});

export type App = Effect.Success<ReturnType<typeof makeApp>>;
