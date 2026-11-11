import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Session } from "./guards.js";
import { signedInErrors } from "../httpApiErrors.js";

export const realtimeGroup = HttpApiGroup.make("realtime")
  // A text/event-stream of realtime events for the signed-in user.
  .add(HttpApiEndpoint.get("events", "/events", { error: signedInErrors }))
  .middleware(Session)
  .prefix("/api");
