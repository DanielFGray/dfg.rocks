// @entrypoint: the in-process API test bridge shares its runtime with request callbacks.
import { Effect, Layer, ManagedRuntime } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import { applicationLayer, HttpApiLive } from "../runtime.js";
import { Worker } from "../../worker/worker.js";

// The application services with no job runner, so the API tests run no jobs.
const testServices = applicationLayer.pipe(
  Layer.provideMerge(Layer.succeed(Worker, { isRunning: Effect.succeed(true) })),
);

// One memo map, so the handler and the runtime share one set of services and pools.
const memoMap = Layer.makeMemoMapUnsafe();

/** Runs Effects on the services the /api handler uses. */
export const testRuntime = ManagedRuntime.make(testServices, { memoMap });

const web = HttpRouter.toWebHandler(HttpApiLive.pipe(Layer.provideMerge(testServices)), {
  memoMap,
  disableLogger: true,
});

/** Answers a request as the server's /api routes do. */
export const handleApiRequest = (request: Request): Promise<Response> => web.handler(request);

export const runApiEffect = <A, E>(
  effect: Effect.Effect<A, E, Layer.Success<typeof testServices>>,
) => testRuntime.runPromise(effect);
