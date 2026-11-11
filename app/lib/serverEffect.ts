import type { Effect } from "effect";
import { type AppServices, serverRuntime } from "../../server/runtime.js";

/**
 * Runs a server function's Effect on the server's services. Server functions are TanStack Start's
 * callbacks, so this is the one place app code runs an Effect.
 */
export const runServerEffect = <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> =>
  serverRuntime.runPromise(effect);
