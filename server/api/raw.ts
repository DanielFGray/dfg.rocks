import * as Cookies from "effect/http/Cookies";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Config, Effect, Schema as S } from "effect";
import { HttpError } from "../pgErrors.js";

export type RawRequest = HttpServerRequest.HttpServerRequest;

export function params<const Name extends string>(...names: readonly Name[]) {
  return S.Struct(
    Object.fromEntries(names.map((name) => [name, S.String])) as Record<Name, typeof S.String>,
  );
}

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

export function csrfCheck(
  headers: Record<string, string | undefined>,
): Effect.Effect<void, HttpError> {
  return headers["x-requested-with"]
    ? Effect.void
    : Effect.fail(new HttpError(400, "Missing CSRF header"));
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
