import { Context, Effect, Layer, Option, Ref } from "effect";
import * as Cookies from "effect/http/Cookies";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import { Contract } from "../shared/httpApi.js";
import { InProcessOrigin, loopbackClient } from "./loopback.js";
import { clientAddressHeader } from "./rateLimit.js";
import { HttpApiLive, type ApplicationServices } from "./runtime.js";

/**
 * The API, answered in this process. `handler` serves /api and /healthz for the process shell.
 * `clientFor` gives a server function the typed API client over that same handler, so a form
 * posted to a server function takes the API's path: its rate limits, its checks, its errors.
 * Design: ~/build/effect-web-template/docs/design/in-process-callers.md.
 */
export class InProcessApi extends Context.Service<InProcessApi>()("dfg-rocks/inProcessApi", {
  make: Effect.gen(function* () {
    const services = yield* Effect.context<ApplicationServices>();
    const handler = (yield* HttpRouter.toHttpEffect(HttpApiLive)).pipe(
      Effect.provideContext(services),
    );
    const http = loopbackClient(handler);
    return {
      handler,
      /**
       * The typed API client for one request that TanStack Start is serving. `setCookieHeaders`
       * gives the cookies the API's responses set (the session, after a login), for the server
       * function to pass on in its own response.
       */
      clientFor: Effect.fn("InProcessApi.clientFor")(function* (incoming: Request) {
        const responseCookies = yield* Ref.make(Cookies.empty);
        const api = yield* HttpApiClient.make(Contract, {
          baseUrl: InProcessOrigin,
          transformClient: (client) =>
            client.pipe(
              HttpClient.mapRequest(forwardedHeaders(incoming.headers)),
              HttpClient.transformResponse(
                Effect.tap((response) =>
                  Ref.update(
                    responseCookies,
                    Cookies.setAllCookie(Object.values(response.cookies.cookies)),
                  ),
                ),
              ),
            ),
        }).pipe(Effect.provideService(HttpClient.HttpClient, http));
        return {
          api,
          setCookieHeaders: Ref.get(responseCookies).pipe(Effect.map(Cookies.toSetCookieHeaders)),
        };
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

/** The typed API client that `InProcessApi.clientFor` gives. */
export type InProcessClient = HttpApiClient.ForApi<typeof Contract>;

/**
 * Copies onto an in-process request what the API reads from the visitor's own request: the
 * session cookie, and the client address the proxy set. A loopback request has no socket, so
 * without the address every visitor's rate limit counts in one bucket and the location check is
 * skipped. The CSRF header is set because the caller is this server, which already accepted the
 * visitor's request.
 */
const forwardedHeaders = (incoming: Headers) =>
  HttpClientRequest.setHeaders({
    ...Object.fromEntries(
      ["cookie", clientAddressHeader].flatMap((name) =>
        Option.match(Option.fromNullishOr(incoming.get(name)), {
          onNone: () => [],
          onSome: (value) => [[name, value]],
        }),
      ),
    ),
    "x-requested-with": "in-process",
  });
