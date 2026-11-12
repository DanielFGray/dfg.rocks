import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Config, Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { HttpError } from "../pgErrors.js";
import {
  decodeOAuthRedirect,
  decodeOAuthState,
  encodeOAuthRedirect,
  encodeOAuthState,
  getOAuthCookieName,
  getOAuthRedirectCookieName,
  getOAuthRedirectTarget,
} from "../services/oauth.js";
import { Geolocation } from "../services/geolocation.js";
import { Families } from "../services/families.js";
import { Account } from "../services/account.js";
import { Contact } from "../services/contact.js";
import { OAuth } from "../services/oauth.js";
import { checkRateLimit, clientIdentifierFromHeaders } from "../rateLimit.js";
import { Users } from "../services/users.js";
import { setSessionCookie } from "./raw.js";

const publicErrorStatuses = [400, 403, 404, 409, 429, 500, 502, 503] as const;

function adaptPublicHttpApiErrors<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return adaptHttpApiErrors(effect, publicErrorStatuses);
}

const fetchGoogleUserInfo = Effect.fnUntraced(function* (accessToken: string) {
  const response = yield* Effect.tryPromise(() =>
    fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  );
  if (!response.ok) {
    return yield* new HttpError({ status: 502, message: "Failed to fetch Google user info" });
  }
  const userInfo = (yield* Effect.tryPromise(
    () => response.json() as Promise<Record<string, unknown>>,
  )) as Record<string, unknown>;
  if (typeof userInfo.sub !== "string") {
    return yield* new HttpError({ status: 400, message: "Google user info is missing subject" });
  }
  return {
    ...userInfo,
    sub: userInfo.sub,
  };
});

export const PublicApiGroupLive = HttpApiBuilder.group(Contract, "public", (handlers) =>
  handlers
    .handle(
      "contact",
      Effect.fnUntraced(function* ({ request, payload }) {
        if (payload.website) {
          return yield* new HttpError({ status: 400, message: "Invalid submission" });
        }
        yield* checkRateLimit("contact", request.headers);
        const ip = clientIdentifierFromHeaders(request.headers);
        if (ip) {
          const loc = yield* Geolocation.use((geolocationService) =>
            geolocationService.lookupIp(ip),
          );
          const isTexas = loc?.country === "US" && loc?.region === "TX";

          if (!isTexas) {
            return yield* new HttpError({
              status: 403,
              message:
                "Sorry, I only accept lesson inquiries from the Houston / Galveston area in Texas. If you're outside Texas, I hope you find a great teacher near you!",
            });
          }
          yield* Contact.use((contactService) =>
            contactService.submitContact(payload, {
              ip,
              country: loc?.country ?? "",
              region: loc?.region ?? "",
              city: loc?.city ?? "",
            }),
          );
        } else {
          yield* Contact.use((contactService) => contactService.submitContact(payload));
        }
        return { success: true as const };
      }, adaptPublicHttpApiErrors),
    )

    .handleRaw(
      "oauthGoogle",
      Effect.fnUntraced(function* ({ request }) {
        const webRequest = request.source as Request;
        const rootUrl = yield* Config.String("VITE_ROOT_URL");
        const oauth = yield* OAuth;
        const authorization = yield* oauth.createAuthorizationRequest(
          "google",
          rootUrl,
          new URL(webRequest.url).searchParams.get("redirect") ?? undefined,
        );
        const oauthCookieName = getOAuthCookieName("google");
        const redirectCookieName = getOAuthRedirectCookieName("google");
        const cookieOptions = yield* oauth.getOAuthCookieOptions("google", rootUrl);
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
          return yield* new HttpError({ status: 400, message: `Google OAuth failed (${error})` });
        }
        if (!code || !state) {
          return yield* new HttpError({
            status: 400,
            message: "Missing Google OAuth callback parameters",
          });
        }
        if (!oauthState?.codeVerifier || oauthState.state !== state) {
          return yield* new HttpError({
            status: 400,
            message: "Invalid or expired Google OAuth state",
          });
        }
        const codeVerifier = oauthState.codeVerifier;
        const oauth = yield* OAuth;
        const tokens = yield* oauth.exchangeGoogleCode(rootUrl, code, codeVerifier);
        const userInfo = yield* fetchGoogleUserInfo(tokens.accessToken());
        const user = yield* OAuth.use((oauthService) =>
          oauthService.linkOrRegisterOAuthUser({
            service: "google",
            identifier: userInfo.sub,
            profile: userInfo,
            tokens: tokens.data,
          }),
        );
        const session = yield* Users.use((userService) => userService.sessionFromUser(user));
        let response = HttpServerResponse.redirect(
          new URL(getOAuthRedirectTarget(redirectTarget), rootUrl).toString(),
        );
        response = yield* HttpServerResponse.expireCookie(
          response,
          cookieName,
          yield* oauth.getOAuthCookieOptions("google", rootUrl),
        );
        response = yield* HttpServerResponse.expireCookie(
          response,
          redirectCookieName,
          yield* oauth.getOAuthCookieOptions("google", rootUrl),
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
        const oauth = yield* OAuth;
        const authorization = yield* oauth.createAuthorizationRequest(
          "apple",
          rootUrl,
          new URL(webRequest.url).searchParams.get("redirect") ?? undefined,
        );
        const oauthCookieName = getOAuthCookieName("apple");
        const redirectCookieName = getOAuthRedirectCookieName("apple");
        const cookieOptions = yield* oauth.getOAuthCookieOptions("apple", rootUrl);
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
          return yield* new HttpError({ status: 400, message: `Apple OAuth failed (${error})` });
        }
        if (!code || !state) {
          return yield* new HttpError({
            status: 400,
            message: "Missing Apple OAuth callback parameters",
          });
        }
        if (!oauthState || oauthState.state !== state) {
          return yield* new HttpError({
            status: 400,
            message: "Invalid or expired Apple OAuth state",
          });
        }
        const oauth = yield* OAuth;
        const tokens = yield* oauth.exchangeAppleCode(rootUrl, code);
        const claims = yield* oauth.verifyAppleIdToken(tokens.idToken());
        const sub = typeof claims.sub === "string" ? claims.sub : undefined;
        if (!sub) {
          return yield* new HttpError({ status: 400, message: "Invalid Apple id_token" });
        }
        const firstName = user?.name?.firstName;
        const lastName = user?.name?.lastName;
        const profile = {
          sub,
          email: typeof claims.email === "string" ? claims.email : user?.email,
          name: [firstName, lastName].filter(Boolean).join(" ").trim() || undefined,
        };
        const linkedUser = yield* OAuth.use((oauthService) =>
          oauthService.linkOrRegisterOAuthUser({
            service: "apple",
            identifier: sub,
            profile,
            tokens: tokens.data,
          }),
        );
        const session = yield* Users.use((userService) => userService.sessionFromUser(linkedUser));
        let response = HttpServerResponse.redirect(
          new URL(getOAuthRedirectTarget(redirectTarget), rootUrl).toString(),
        );
        response = yield* HttpServerResponse.expireCookie(
          response,
          cookieName,
          yield* oauth.getOAuthCookieOptions("apple", rootUrl),
        );
        response = yield* HttpServerResponse.expireCookie(
          response,
          redirectCookieName,
          yield* oauth.getOAuthCookieOptions("apple", rootUrl),
        );
        response = yield* setSessionCookie(response, session.token, session.expiresAt);
        return response;
      }, adaptPublicHttpApiErrors),
    )

    .handle(
      "verifyEmail",
      Effect.fnUntraced(function* ({ payload }) {
        yield* Account.use((accountService) => accountService.verifyEmail(payload.token));
        return { success: true as const };
      }, adaptPublicHttpApiErrors),
    )

    .handle(
      "invitation",
      Effect.fnUntraced(function* ({ params, query }) {
        return yield* Families.use((familyService) =>
          familyService.invitation(params.id, query.code ?? ""),
        );
      }, adaptPublicHttpApiErrors),
    )

    .handle(
      "acceptInvitation",
      Effect.fnUntraced(function* ({ request, params, payload }) {
        yield* checkRateLimit("accept-invite", request.headers);
        const session = yield* Families.use((familyService) =>
          familyService.acceptInvitation({
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
