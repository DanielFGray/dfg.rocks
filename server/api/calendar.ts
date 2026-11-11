import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect, Config } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { GoogleCalendarService } from "../services/googleCalendarService.js";
import { AdminRouteService } from "../services/adminRouteService.js";
import { adaptAdminErrors } from "../httpApiErrors.js";

export const CalendarConnectAdminApiGroupLive = HttpApiBuilder.group(
  Contract,
  "calendarConnectAdmin",
  (handlers) =>
    handlers
      .handle(
        "gcalConnect",
        Effect.fnUntraced(function* () {
          const rootUrl = yield* Config.String("VITE_ROOT_URL");
          const authorization = yield* GoogleCalendarService.use((googleCalendarService) =>
            googleCalendarService.createAuthorizationRequest(rootUrl),
          );
          let response = HttpServerResponse.redirect(authorization.url.toString());
          response = yield* HttpServerResponse.setCookie(
            response,
            GoogleCalendarService.getAuthCookieName(),
            GoogleCalendarService.encodeAuthState(authorization.state),
            yield* GoogleCalendarService.getAuthCookieOptions(rootUrl),
          );
          return response;
        }, adaptAdminErrors),
      )
      .handle(
        "gcalCallback",
        Effect.fnUntraced(function* ({ request, query }) {
          const rootUrl = yield* Config.String("VITE_ROOT_URL");
          const authCookieName = GoogleCalendarService.getAuthCookieName();
          const cookieOptions = yield* GoogleCalendarService.getAuthCookieOptions(rootUrl);
          const authState = yield* GoogleCalendarService.decodeAuthState(
            request.cookies[authCookieName],
          );
          // OAuth failures are raw responses so the one-time state cookie is expired on failure.
          const fail = (status: number, message: string) =>
            HttpServerResponse.expireCookie(
              HttpServerResponse.jsonUnsafe({ error: message }, { status }),
              authCookieName,
              cookieOptions,
            );
          if (query.error) {
            return yield* fail(400, `Google Calendar OAuth failed (${query.error})`);
          }
          if (!query.code || !query.state) {
            return yield* fail(400, "Missing Google Calendar OAuth callback parameters");
          }
          const code = query.code;
          if (!authState || authState.state !== query.state) {
            return yield* fail(400, "Invalid or expired Google Calendar OAuth state");
          }
          yield* GoogleCalendarService.use((googleCalendarService) =>
            googleCalendarService.handleCallback(rootUrl, code, authState.codeVerifier),
          );
          let response = HttpServerResponse.redirect(
            GoogleCalendarService.getConnectRedirectUrl(rootUrl, authState.redirect),
          );
          response = yield* HttpServerResponse.expireCookie(
            response,
            authCookieName,
            cookieOptions,
          );
          return response;
        }, adaptAdminErrors),
      ),
);

export const CalendarAdminApiGroupLive = HttpApiBuilder.group(
  Contract,
  "calendarAdmin",
  (handlers) =>
    handlers
      .handle(
        "gcalStatus",
        Effect.fnUntraced(function* () {
          const status = yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.getGoogleCalendarStatus(),
          );
          return {
            connected: status.connected,
            calendar_id: typeof status.calendar_id === "string" ? status.calendar_id : null,
          };
        }, adaptAdminErrors),
      )
      .handle(
        "gcalDisconnect",
        Effect.fnUntraced(function* () {
          yield* AdminRouteService.use((adminRouteService) =>
            adminRouteService.disconnectGoogleCalendar(),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      ),
);
