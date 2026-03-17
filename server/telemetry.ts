import { DevTools } from "@effect/experimental";
import { Layer } from "effect";
import { env } from "./assertEnv.js";

const isDev = env.NODE_ENV !== "production";

// DevTools layer connects via WebSocket to effect-devtui (port 34437)
const DevToolsLive = isDev ? DevTools.layer() : Layer.empty;

export const TelemetryLive = DevToolsLive;
