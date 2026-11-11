import * as Cookies from "effect/http/Cookies";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Config, Effect } from "effect";
import { HttpError } from "../pgErrors.js";
import { SessionService, type SessionResult } from "../services/sessionService.js";

export type RawRequest = HttpServerRequest.HttpServerRequest;

/** The session named by the request's cookie, or a 401 when there is none. */
export const requireSession = Effect.fnUntraced(function* (request: RawRequest) {
  const session = yield* SessionService.use((sessionService) =>
    sessionService.validateSessionToken(request.cookies.session),
  );
  if (!session) {
    return yield* new HttpError(401, "Unauthorized");
  }
  return session;
});

/** A signed-in request: its session and user. */
export type Auth = NonNullable<SessionResult>;

/** The session of an admin, or 401 / 403; then the CSRF header unless `csrf` is false. */
export const requireAdminSession = Effect.fnUntraced(function* (
  request: RawRequest,
  options: {
    csrf?: boolean;
  } = {},
) {
  const result = yield* requireSession(request);
  if (result.user.role !== "admin") {
    return yield* new HttpError(403, "Forbidden");
  }
  if (options.csrf !== false) {
    yield* csrfCheck(request.headers);
  }
  return result;
});

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
