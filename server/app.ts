import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";
import { Config, Effect, Layer } from "effect";
import { authGroup, healthGroup, publicGroup } from "../shared/httpApi.js";
import {
  makeAdminLayer,
  adminGroup,
  makeMaterialDownloadLayer,
  materialDownloadGroup,
} from "./routes/admin.js";
import { makeAuthLayer } from "./routes/auth.js";
import { authenticatedGroup, makeAuthenticatedLayer } from "./routes/authenticated.js";
import { makeHealthLayer, makePublicLayer } from "./routes/public.js";
import { applicationLayer, memoMap, serverRuntime } from "./runtime.js";
import { BackgroundWorker, type WorkerPaths } from "./services/backgroundWorker.js";

const ServerApi = HttpApi.make("dfg")
  .add(healthGroup)
  .add(publicGroup)
  .add(authGroup)
  .add(authenticatedGroup)
  .add(adminGroup)
  .add(materialDownloadGroup);

const ApiLive = HttpApiBuilder.layer(ServerApi).pipe(
  Layer.provide(
    Layer.mergeAll(
      makeHealthLayer(),
      makePublicLayer(),
      makeAuthLayer(),
      makeAuthenticatedLayer(),
      makeAdminLayer(),
      makeMaterialDownloadLayer(),
    ),
  ),
);

/** The testing routes are imported only outside production, so the production bundle never loads them. */
const TestingMountLive = Layer.unwrap(
  Effect.gen(function* () {
    if ((yield* Config.String("NODE_ENV")) === "production") return Layer.empty;
    const { TestingHttpApiLive } = yield* Effect.promise(() => import("./routes/testing.js"));
    return TestingHttpApiLive;
  }),
);

/**
 * Every /api route, with the application services merged in so handlers find them per request.
 * It builds from the memo map serverRuntime uses, so pages and /api share one set of services.
 */
export const HttpApiLive = Layer.mergeAll(ApiLive, TestingMountLive).pipe(
  Layer.provideMerge(applicationLayer),
);

const web = HttpRouter.toWebHandler(HttpApiLive, { memoMap, disableLogger: true });

export function handleApiRequest(request: Request): Promise<Response> {
  return web.handler(request);
}

// Starts the in-process job runner. The production entry calls this once, after the HTTP server listens.
export async function startWorker(paths: WorkerPaths): Promise<void> {
  await serverRuntime.runPromise(BackgroundWorker.use((worker) => worker.start(paths)));
}

export async function disposeApiHandler(): Promise<void> {
  await web.dispose();
  await serverRuntime.dispose();
}
