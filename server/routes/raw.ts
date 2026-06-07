import * as Cookies from "@effect/platform/Cookies";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import * as Cause from "effect/Cause";
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
  return Effect.runSync(
    HttpServerResponse.setCookie(response, "session", token, {
      ...defaultCookieOptions(),
      expires: expiresAt,
    }),
  );
}

export function expireSessionCookie(response: HttpServerResponse.HttpServerResponse) {
  return HttpServerResponse.expireCookie(
    response,
    "session",
    defaultCookieOptions(),
  );
}

export function csrfCheck(headers: Record<string, string | undefined>): void {
  if (!headers["x-requested-with"]) {
    throw HttpError.make(400, "Missing CSRF header");
  }
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

export function responseForCause(cause: Cause.Cause<unknown>) {
  const error = Cause.squash(cause);
  if (error instanceof HttpError) {
    return Effect.succeed(
      HttpServerResponse.unsafeJson(
        { error: error.message },
        { status: error.status },
      ),
    );
  }
  console.error(error);
  return Effect.succeed(
    HttpServerResponse.unsafeJson(
      { error: "Internal Server Error" },
      { status: 500 },
    ),
  );
}
