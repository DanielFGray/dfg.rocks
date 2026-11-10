import * as HttpRouter from "effect/http/HttpRouter";
import { HttpApiLive, memoMap, serverRuntime } from "./runtime.js";
import { BackgroundWorker, type WorkerPaths } from "./services/backgroundWorker.js";

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
