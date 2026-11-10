import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Config, Effect } from "effect";
import { HealthUnavailableError, healthGroup, publicGroup } from "../../shared/httpApi.js";
import { PgAuthDB } from "../db.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { HttpError } from "../pgErrors.js";
import { BackgroundWorker } from "../services/backgroundWorker.js";
import {
  createAuthorizationRequest,
  decodeOAuthRedirect,
  decodeOAuthState,
  encodeOAuthRedirect,
  encodeOAuthState,
  exchangeAppleCode,
  exchangeGoogleCode,
  getOAuthCookieName,
  getOAuthCookieOptions,
  getOAuthRedirectCookieName,
  getOAuthRedirectTarget,
  verifyAppleIdToken,
} from "../services/oauthService.js";
import { GeolocationService } from "../services/geolocation.js";
import { PublicRouteService } from "../services/publicRouteService.js";
import { checkRateLimit, clientIdentifierFromHeaders } from "../services/rateLimiter.js";
import { UserService } from "../services/userService.js";
import { csrfCheck, setSessionCookie } from "./raw.js";

const publicErrorStatuses = [400, 403, 404, 409, 429, 500, 502, 503] as const;

function adaptPublicHttpApiErrors<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return adaptHttpApiErrors(effect, publicErrorStatuses);
}

const fetchGoogleUserInfo = Effect.fnUntraced(function* (accessToken: string) {
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    catch: (error) => error,
  });
  if (!response.ok) {
    return yield* new HttpError(502, "Failed to fetch Google user info");
  }
  const userInfo = (yield* Effect.tryPromise({
    try: () => response.json() as Promise<Record<string, unknown>>,
    catch: (error) => error,
  })) as Record<string, unknown>;
  if (typeof userInfo.sub !== "string") {
    return yield* new HttpError(400, "Google user info is missing subject");
  }
  return {
    ...userInfo,
    sub: userInfo.sub,
  };
});

const publicApi = HttpApi.make("dfg").add(publicGroup);

export const healthApi = HttpApi.make("dfg").add(healthGroup);

// How long the database check may take before the platform sees the app as down.
const DATABASE_CHECK_TIMEOUT = "2 seconds";

export function makeHealthLayer() {
  return HttpApiBuilder.group(healthApi, "health", (handlers) =>
    Effect.map(Config.NonEmptyString("GIT_COMMIT").pipe(Config.withDefault("unknown")), (commit) =>
      handlers.handle(
        "healthz",
        Effect.fnUntraced(function* () {
          const db = yield* PgAuthDB;
          const databaseDown = yield* db.execute(db.selectNoFrom((eb) => eb.lit(1).as("one"))).pipe(
            Effect.timeout(DATABASE_CHECK_TIMEOUT),
            Effect.as(false),
            Effect.catch((cause) =>
              Effect.logError("Health check: database unreachable", cause).pipe(Effect.as(true)),
            ),
          );
          const worker = yield* BackgroundWorker;
          const workerFailed = yield* worker.failed;
          const failed = [
            ...(databaseDown ? ["database"] : []),
            ...(workerFailed ? ["worker"] : []),
          ];
          if (failed.length > 0) {
            return yield* new HealthUnavailableError({ commit, failed });
          }
          return { status: "ok" as const, commit };
        }),
      ),
    ),
  );
}

export function makePublicLayer() {
  return HttpApiBuilder.group(publicApi, "public", (handlers) =>
    handlers
      .handle(
        "contact",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* csrfCheck(request.headers);
          if (payload.website) {
            return yield* new HttpError(400, "Invalid submission");
          }
          yield* checkRateLimit("contact", request.headers, 5, 60000);
          const ip = clientIdentifierFromHeaders(request.headers);
          if (ip) {
            const loc = yield* GeolocationService.use((geolocationService) =>
              geolocationService.lookupIp(ip),
            );
            const isTexas = loc?.country === "US" && loc?.region === "TX";

            if (!isTexas) {
              return yield* new HttpError(
                403,
                "Sorry, I only accept lesson inquiries from the Houston / Galveston area in Texas. If you're outside Texas, I hope you find a great teacher near you!",
              );
            }
            yield* PublicRouteService.use((publicRouteService) =>
              publicRouteService.submitContact(payload, {
                ip,
                country: loc?.country ?? "",
                region: loc?.region ?? "",
                city: loc?.city ?? "",
              }),
            );
          } else {
            yield* PublicRouteService.use((publicRouteService) =>
              publicRouteService.submitContact(payload),
            );
          }
          return { success: true as const };
        }, adaptPublicHttpApiErrors),
      )

      .handleRaw(
        "oauthGoogle",
        Effect.fnUntraced(function* ({ request }) {
          const webRequest = request.source as Request;
          const rootUrl = yield* Config.String("VITE_ROOT_URL");
          const authorization = yield* createAuthorizationRequest(
            "google",
            rootUrl,
            new URL(webRequest.url).searchParams.get("redirect") ?? undefined,
          );
          const oauthCookieName = getOAuthCookieName("google");
          const redirectCookieName = getOAuthRedirectCookieName("google");
          const cookieOptions = yield* getOAuthCookieOptions("google", rootUrl);
          let response = HttpServerResponse.redirect(authorization.url.toString());
          response = yield* HttpServerResponse.setCookie(
            response,
            oauthCookieName,
            encodeOAuthState(authorization.state),
            cookieOptions,
          );
          response = authorization.state.redirect
            ? yield* HttpServerResponse.setCookie(
                response,
                redirectCookieName,
                encodeOAuthRedirect(authorization.state.redirect),
                cookieOptions,
              )
            : yield* HttpServerResponse.expireCookie(response, redirectCookieName, cookieOptions);
          return response;
        }, adaptPublicHttpApiErrors),
      )

      .handleRaw(
        "oauthGoogleCallback",
        Effect.fnUntraced(function* ({ request }) {
          const webRequest = request.source as Request;
          const rootUrl = yield* Config.String("VITE_ROOT_URL");
          const query = new URL(webRequest.url).searchParams;
          const cookieName = getOAuthCookieName("google");
          const redirectCookieName = getOAuthRedirectCookieName("google");
          const oauthState = decodeOAuthState(request.cookies[cookieName]);
          const redirectTarget =
            oauthState?.redirect ?? decodeOAuthRedirect(request.cookies[redirectCookieName]);
          const error = query.get("error") ?? undefined;
          const code = query.get("code") ?? undefined;
          const state = query.get("state") ?? undefined;
          if (error) {
            return yield* new HttpError(400, `Google OAuth failed (${error})`);
          }
          if (!code || !state) {
            return yield* new HttpError(400, "Missing Google OAuth callback parameters");
          }
          if (!oauthState?.codeVerifier || oauthState.state !== state) {
            return yield* new HttpError(400, "Invalid or expired Google OAuth state");
          }
          const codeVerifier = oauthState.codeVerifier;
          const tokens = yield* exchangeGoogleCode(rootUrl, code, codeVerifier);
          const userInfo = yield* fetchGoogleUserInfo(tokens.accessToken());
          const user = yield* PublicRouteService.use((publicRouteService) =>
            publicRouteService.linkOrRegisterOAuthUser({
              service: "google",
              identifier: userInfo.sub,
              profile: userInfo,
              tokens: tokens.data,
            }),
          );
          const session = yield* UserService.use((userService) =>
            userService.sessionFromUser(user),
          );
          let response = HttpServerResponse.redirect(
            new URL(getOAuthRedirectTarget(redirectTarget), rootUrl).toString(),
          );
          response = yield* HttpServerResponse.expireCookie(
            response,
            cookieName,
            yield* getOAuthCookieOptions("google", rootUrl),
          );
          response = yield* HttpServerResponse.expireCookie(
            response,
            redirectCookieName,
            yield* getOAuthCookieOptions("google", rootUrl),
          );
          response = yield* setSessionCookie(response, session.token, session.expiresAt);
          return response;
        }, adaptPublicHttpApiErrors),
      )

      .handleRaw(
        "oauthApple",
        Effect.fnUntraced(function* ({ request }) {
          const webRequest = request.source as Request;
          const rootUrl = yield* Config.String("VITE_ROOT_URL");
          const authorization = yield* createAuthorizationRequest(
            "apple",
            rootUrl,
            new URL(webRequest.url).searchParams.get("redirect") ?? undefined,
          );
          const oauthCookieName = getOAuthCookieName("apple");
          const redirectCookieName = getOAuthRedirectCookieName("apple");
          const cookieOptions = yield* getOAuthCookieOptions("apple", rootUrl);
          let response = yield* HttpServerResponse.setCookie(
            HttpServerResponse.redirect(authorization.url.toString()),
            oauthCookieName,
            encodeOAuthState(authorization.state),
            cookieOptions,
          );
          response = authorization.state.redirect
            ? yield* HttpServerResponse.setCookie(
                response,
                redirectCookieName,
                encodeOAuthRedirect(authorization.state.redirect),
                cookieOptions,
              )
            : yield* HttpServerResponse.expireCookie(response, redirectCookieName, cookieOptions);
          return response;
        }, adaptPublicHttpApiErrors),
      )

      .handle(
        "oauthAppleCallback",
        Effect.fnUntraced(function* ({ request, payload }) {
          const rootUrl = yield* Config.String("VITE_ROOT_URL");
          const cookieName = getOAuthCookieName("apple");
          const redirectCookieName = getOAuthRedirectCookieName("apple");
          const oauthState = decodeOAuthState(request.cookies[cookieName]);
          const redirectTarget =
            oauthState?.redirect ?? decodeOAuthRedirect(request.cookies[redirectCookieName]);
          const { error, code, state, user } = payload;
          if (error) {
            return yield* new HttpError(400, `Apple OAuth failed (${error})`);
          }
          if (!code || !state) {
            return yield* new HttpError(400, "Missing Apple OAuth callback parameters");
          }
          if (!oauthState || oauthState.state !== state) {
            return yield* new HttpError(400, "Invalid or expired Apple OAuth state");
          }
          const tokens = yield* exchangeAppleCode(rootUrl, code);
          const claims = yield* verifyAppleIdToken(tokens.idToken());
          const sub = typeof claims.sub === "string" ? claims.sub : undefined;
          if (!sub) {
            return yield* new HttpError(400, "Invalid Apple id_token");
          }
          const firstName = user?.name?.firstName;
          const lastName = user?.name?.lastName;
          const profile = {
            sub,
            email: typeof claims.email === "string" ? claims.email : user?.email,
            name: [firstName, lastName].filter(Boolean).join(" ").trim() || undefined,
          };
          const linkedUser = yield* PublicRouteService.use((publicRouteService) =>
            publicRouteService.linkOrRegisterOAuthUser({
              service: "apple",
              identifier: sub,
              profile,
              tokens: tokens.data,
            }),
          );
          const session = yield* UserService.use((userService) =>
            userService.sessionFromUser(linkedUser),
          );
          let response = HttpServerResponse.redirect(
            new URL(getOAuthRedirectTarget(redirectTarget), rootUrl).toString(),
          );
          response = yield* HttpServerResponse.expireCookie(
            response,
            cookieName,
            yield* getOAuthCookieOptions("apple", rootUrl),
          );
          response = yield* HttpServerResponse.expireCookie(
            response,
            redirectCookieName,
            yield* getOAuthCookieOptions("apple", rootUrl),
          );
          response = yield* setSessionCookie(response, session.token, session.expiresAt);
          return response;
        }, adaptPublicHttpApiErrors),
      )

      .handle(
        "verifyEmail",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* csrfCheck(request.headers);
          yield* PublicRouteService.use((publicRouteService) =>
            publicRouteService.verifyEmail(payload.token),
          );
          return { success: true as const };
        }, adaptPublicHttpApiErrors),
      )

      .handle(
        "invitation",
        Effect.fnUntraced(function* ({ params, query }) {
          return yield* PublicRouteService.use((publicRouteService) =>
            publicRouteService.invitation(params.id, query.code ?? ""),
          );
        }, adaptPublicHttpApiErrors),
      )

      .handle(
        "acceptInvitation",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          yield* csrfCheck(request.headers);
          yield* checkRateLimit("accept-invite", request.headers, 10, 60000);
          const session = yield* PublicRouteService.use((publicRouteService) =>
            publicRouteService.acceptInvitation({
              invitationId: params.id,
              code: payload.code,
              username: payload.username,
              password: payload.password,
              name: payload.name,
              email: payload.email,
            }),
          );
          let response = HttpServerResponse.jsonUnsafe(session.response);
          response = yield* setSessionCookie(response, session.token, session.expiresAt);
          return response;
        }, adaptPublicHttpApiErrors),
      ),
  );
}
