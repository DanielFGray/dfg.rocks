import * as HttpRouter from "effect/http/HttpRouter";
import { HttpApiLive, memoMap, serverRuntime } from "./runtime.js";
import { BackgroundWorker } from "./services/backgroundWorker.js";

const web = HttpRouter.toWebHandler(HttpApiLive, { memoMap, disableLogger: true });

export function handleApiRequest(request: Request): Promise<Response> {
  return web.handler(request);
}

// Starts the in-process job runner. serve.ts and the dev server (scripts/devJobRunnerPlugin.ts) call
// this once, after the HTTP server listens.
export async function startWorker(workerDirectory: string): Promise<void> {
  await serverRuntime.runPromise(BackgroundWorker.use((worker) => worker.start(workerDirectory)));
}

export async function disposeApiHandler(): Promise<void> {
  await web.dispose();
  await serverRuntime.dispose();
}
