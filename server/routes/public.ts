import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect } from "effect";
import { publicGroup } from "../../shared/httpApi.js";
import { HttpError } from "../pgErrors.js";
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
import { PublicRouteService } from "../services/publicRouteService.js";
import { checkRateLimit } from "../services/rateLimiter.js";
import { UserService } from "../services/userService.js";
import { csrfCheck, setSessionCookie, responseForCause } from "./raw.js";

const fetchGoogleUserInfo = Effect.fnUntraced(function* (accessToken: string) {
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    catch: (error) => error,
  });
  if (!response.ok) {
    return yield* HttpError.make(502, "Failed to fetch Google user info");
  }
  const userInfo = (yield* Effect.tryPromise({
    try: () => response.json() as Promise<Record<string, unknown>>,
    catch: (error) => error,
  })) as Record<string, unknown>;
  if (typeof userInfo.sub !== "string") {
    return yield* HttpError.make(400, "Google user info is missing subject");
  }
  return {
    ...userInfo,
    sub: userInfo.sub,
  };
});

const publicApi = HttpApi.make("dfg").add(publicGroup);

export function makePublicLayer() {
  return HttpApiBuilder.group(publicApi, "public", (handlers) =>
    handlers
      .handleRaw("health", () =>
        Effect.succeed({ success: true as const }).pipe(Effect.catchAllCause(responseForCause)),
      )

      .handle(
        "contact",
        Effect.fnUntraced(function* ({ request, payload }) {
          csrfCheck(request.headers);
          if (payload.website) {
            return yield* new HttpError(400, "Invalid submission");
          }
          yield* checkRateLimit("contact", request.headers, 5, 60000);
          yield* (yield* PublicRouteService).submitContact(payload);
          return { success: true as const };
        }, Effect.catchAllCause(responseForCause)),
      )

      .handleRaw("oauthGoogle", function ({ request }) {
        const webRequest = request.source as Request;
        const rootUrl = new URL(webRequest.url).origin;
        const authorization = createAuthorizationRequest(
          "google",
          rootUrl,
          new URL(webRequest.url).searchParams.get("redirect") ?? undefined,
        );
        const oauthCookieName = getOAuthCookieName("google");
        const redirectCookieName = getOAuthRedirectCookieName("google");
        const cookieOptions = getOAuthCookieOptions("google", rootUrl);
        let response = HttpServerResponse.redirect(authorization.url.toString());
        response = Effect.runSync(
          HttpServerResponse.setCookie(
            response,
            oauthCookieName,
            encodeOAuthState(authorization.state),
            cookieOptions,
          ),
        );
        response = authorization.state.redirect
          ? Effect.runSync(
              HttpServerResponse.setCookie(
                response,
                redirectCookieName,
                encodeOAuthRedirect(authorization.state.redirect),
                cookieOptions,
              ),
            )
          : HttpServerResponse.expireCookie(response, redirectCookieName, cookieOptions);
        return Effect.succeed(response).pipe(Effect.catchAllCause(responseForCause));
      })

      .handleRaw(
        "oauthGoogleCallback",
        Effect.fnUntraced(function* ({ request }) {
          const webRequest = request.source as Request;
          const rootUrl = new URL(webRequest.url).origin;
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
          const user = yield* (yield* PublicRouteService).linkOrRegisterOAuthUser({
            service: "google",
            identifier: userInfo.sub,
            profile: userInfo,
            tokens: tokens.data,
          });
          const session = yield* UserService.sessionFromUser(user);
          let response = HttpServerResponse.redirect(
            new URL(getOAuthRedirectTarget(redirectTarget), webRequest.url).toString(),
          );
          response = HttpServerResponse.expireCookie(
            response,
            cookieName,
            getOAuthCookieOptions("google", rootUrl),
          );
          response = HttpServerResponse.expireCookie(
            response,
            redirectCookieName,
            getOAuthCookieOptions("google", rootUrl),
          );
          response = setSessionCookie(response, session.token, session.expiresAt);
          return response;
        }, Effect.catchAllCause(responseForCause)),
      )

      .handleRaw("oauthApple", function ({ request }) {
        const webRequest = request.source as Request;
        const rootUrl = new URL(webRequest.url).origin;
        const authorization = createAuthorizationRequest(
          "apple",
          rootUrl,
          new URL(webRequest.url).searchParams.get("redirect") ?? undefined,
        );
        const oauthCookieName = getOAuthCookieName("apple");
        const redirectCookieName = getOAuthRedirectCookieName("apple");
        const cookieOptions = getOAuthCookieOptions("apple", rootUrl);
        let response = HttpServerResponse.redirect(authorization.url.toString());
        response = Effect.runSync(
          HttpServerResponse.setCookie(
            response,
            oauthCookieName,
            encodeOAuthState(authorization.state),
            cookieOptions,
          ),
        );
        response = authorization.state.redirect
          ? Effect.runSync(
              HttpServerResponse.setCookie(
                response,
                redirectCookieName,
                encodeOAuthRedirect(authorization.state.redirect),
                cookieOptions,
              ),
            )
          : HttpServerResponse.expireCookie(response, redirectCookieName, cookieOptions);
        return Effect.succeed(response).pipe(Effect.catchAllCause(responseForCause));
      })

      .handle(
        "oauthAppleCallback",
        Effect.fnUntraced(function* ({ request, payload }) {
          const webRequest = request.source as Request;
          const rootUrl = new URL(webRequest.url).origin;
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
          const linkedUser = yield* (yield* PublicRouteService).linkOrRegisterOAuthUser({
            service: "apple",
            identifier: sub,
            profile,
            tokens: tokens.data,
          });
          const session = yield* UserService.sessionFromUser(linkedUser);
          let response = HttpServerResponse.redirect(
            new URL(getOAuthRedirectTarget(redirectTarget), webRequest.url).toString(),
          );
          response = HttpServerResponse.expireCookie(
            response,
            cookieName,
            getOAuthCookieOptions("apple", rootUrl),
          );
          response = HttpServerResponse.expireCookie(
            response,
            redirectCookieName,
            getOAuthCookieOptions("apple", rootUrl),
          );
          response = setSessionCookie(response, session.token, session.expiresAt);
          return response;
        }, Effect.catchAllCause(responseForCause)),
      )

      .handle(
        "verifyEmail",
        Effect.fnUntraced(function* ({ request, payload }) {
          csrfCheck(request.headers);
          yield* (yield* PublicRouteService).verifyEmail(payload.token);
          return { success: true as const };
        }, Effect.catchAllCause(responseForCause)),
      )

      .handleRaw(
        "invitation",
        Effect.fnUntraced(function* ({ path, urlParams }) {
          return yield* (yield* PublicRouteService).invitation(path.id, urlParams.code ?? "");
        }, Effect.catchAllCause(responseForCause)),
      )

      .handle(
        "acceptInvitation",
        Effect.fnUntraced(function* ({ request, path, payload }) {
          csrfCheck(request.headers);
          yield* checkRateLimit("accept-invite", request.headers, 10, 60000);
          const session = yield* (yield* PublicRouteService).acceptInvitation({
            invitationId: path.id,
            code: payload.code,
            username: payload.username,
            password: payload.password,
            name: payload.name,
            email: payload.email,
            role: payload.role,
          });
          let response = HttpServerResponse.unsafeJson(session.response);
          response = setSessionCookie(response, session.token, session.expiresAt);
          return response;
        }, Effect.catchAllCause(responseForCause)),
      ),
  );
}
