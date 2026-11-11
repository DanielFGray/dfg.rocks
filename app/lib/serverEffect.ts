import { getGlobalStartContext } from "@tanstack/react-start";
import { Effect, type Context } from "effect";
import type { AppServices } from "../../server/runtime.js";

declare module "@tanstack/react-start" {
  interface Register {
    server: {
      // The process shell passes its services with every request it hands to TanStack Start.
      requestContext: { readonly services: Context.Context<AppServices> };
    };
  }
}

/**
 * Runs a server function's Effect on the services of the process that serves the request. Server
 * functions are TanStack Start's callbacks, so this is the one place app code runs an Effect.
 */
export const runServerEffect = <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> => {
  const context = getGlobalStartContext();
  return context === undefined
    ? Effect.runPromise(Effect.die("A server function ran outside a request"))
    : Effect.runPromiseWith(context.services)(effect);
};
