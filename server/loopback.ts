import { Effect } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type * as HttpServerError from "effect/http/HttpServerError";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Scope } from "effect/Scope";

/**
 * Where an in-process client addresses its requests. The name must be absolute so a `Request` can
 * be built from it; nothing dials it.
 */
export const InProcessOrigin = "http://api.internal";

/** An HTTP handler as the router builds it: one response for the request in context. */
export type HttpHandler = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  HttpServerError.HttpServerError,
  HttpServerRequest.HttpServerRequest | Scope
>;

/**
 * An `HttpClient` that answers each request with `handler` in this process: no socket and no
 * fetch, but the whole request and response round trip, so encoding, middleware and error
 * decoding behave as they do over the wire.
 */
export const loopbackClient = (handler: HttpHandler) =>
  HttpClient.make((request) =>
    Effect.gen(function* () {
      const webRequest = yield* HttpClientRequest.toWeb(request);
      const response = yield* handler.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(webRequest),
        ),
        Effect.scoped,
      );
      return HttpClientResponse.fromWeb(request, HttpServerResponse.toWeb(response));
    }).pipe(
      // The router answers every route, unknown ones with a 404 response, so a failure here is a
      // defect in this process, not a transport error a caller could retry.
      Effect.orDie,
    ),
  );
