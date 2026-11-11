import * as Cookies from "effect/http/Cookies";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Config, Effect } from "effect";

const defaultCookieOptions = Effect.gen(function* () {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: (yield* Config.String("NODE_ENV")) === "production",
    path: "/",
  } satisfies NonNullable<Cookies.Cookie["options"]>;
});

export function setSessionCookie(
  response: HttpServerResponse.HttpServerResponse,
  token: string,
  expiresAt: Date,
) {
  return Effect.flatMap(defaultCookieOptions, (options) =>
    HttpServerResponse.setCookie(response, "session", token, { ...options, expires: expiresAt }),
  );
}

export function expireSessionCookie(response: HttpServerResponse.HttpServerResponse) {
  return Effect.flatMap(defaultCookieOptions, (options) =>
    HttpServerResponse.expireCookie(response, "session", options),
  );
}

export function normalizeToResponse(value: unknown): HttpServerResponse.HttpServerResponse {
  if (value instanceof Response) {
    return HttpServerResponse.fromWeb(value);
  }
  if (HttpServerResponse.isHttpServerResponse(value)) {
    return value;
  }
  return value === undefined
    ? HttpServerResponse.empty({ status: 204 })
    : HttpServerResponse.jsonUnsafe(value);
}
