import * as Cookies from "@effect/platform/Cookies";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect, Schema as S } from "effect";
import { env } from "../assertEnv.js";
import { HttpError } from "../pgErrors.js";

export type RawRequest = HttpServerRequest.HttpServerRequest;

export function params<const Name extends string>(...names: readonly Name[]) {
  return S.Struct(
    Object.fromEntries(names.map((name) => [name, S.String])) as Record<Name, typeof S.String>,
  );
}

function defaultCookieOptions(): NonNullable<Cookies.Cookie["options"]> {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
  };
}

export function setSessionCookie(
  response: HttpServerResponse.HttpServerResponse,
  token: string,
  expiresAt: Date,
) {
  return HttpServerResponse.setCookie(response, "session", token, {
    ...defaultCookieOptions(),
    expires: expiresAt,
  });
}

export function expireSessionCookie(response: HttpServerResponse.HttpServerResponse) {
  return HttpServerResponse.expireCookie(response, "session", defaultCookieOptions());
}

export function csrfCheck(
  headers: Record<string, string | undefined>,
): Effect.Effect<void, HttpError> {
  return headers["x-requested-with"]
    ? Effect.void
    : Effect.fail(HttpError.make(400, "Missing CSRF header"));
}

export function normalizeToResponse(value: unknown): HttpServerResponse.HttpServerResponse {
  if (value instanceof Response) {
    return HttpServerResponse.fromWeb(value);
  }
  if (HttpServerResponse.isServerResponse(value)) {
    return value;
  }
  return value === undefined
    ? HttpServerResponse.empty({ status: 204 })
    : HttpServerResponse.unsafeJson(value);
}
