import {
  createStartHandler,
  defaultStreamHandler,
  type RequestOptions,
} from "@tanstack/react-start/server";
import { disposeApiHandler, startWorker } from "../server/app.js";

const startHandler = createStartHandler(defaultStreamHandler);

// serve.ts is outside this bundle, so the process lifecycle reaches the server through these three
// members: the request handler, the job runner start, and disposal on shutdown.
export default {
  async fetch(request: Request, opts?: RequestOptions<unknown>) {
    return startHandler(request, opts);
  },
  startWorker,
  dispose: disposeApiHandler,
};
