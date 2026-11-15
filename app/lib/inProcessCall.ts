import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { Effect } from "effect";
import { InProcessApi, type InProcessClient } from "../../server/inProcessApi.js";
import { runServerEffect } from "./serverEffect.js";

/**
 * Runs one API call for the request a server function is serving, through the API's own handler
 * in this process, so the endpoint's rate limits and checks run as they do for /api. The cookies
 * the endpoint sets (the session, after a login) go on the server function's response.
 */
export async function callApi<A, E>(
  call: (api: InProcessClient) => Effect.Effect<A, E>,
): Promise<A> {
  const request = getRequest();
  const { result, cookies } = await runServerEffect(
    Effect.gen(function* () {
      const { api, setCookieHeaders } = yield* InProcessApi.use((inProcess) =>
        inProcess.clientFor(request),
      );
      const result = yield* call(api);
      return { result, cookies: yield* setCookieHeaders };
    }),
  );
  if (cookies.length > 0) setResponseHeader("set-cookie", cookies);
  return result;
}
