import type { Register } from "@tanstack/react-start";
import {
  createStartHandler,
  defaultStreamHandler,
  type RequestOptions,
} from "@tanstack/react-start/server";
import { App } from "../server/app.js";

const startHandler = createStartHandler(defaultStreamHandler);

// The production shell (server/main.ts) loads the built bundle, so it reaches the application
// through this object: the page handler, and the constructor of the services and the /api handler.
export default {
  fetch(request: Request, opts: RequestOptions<Register>) {
    return startHandler(request, opts);
  },
  App,
};
