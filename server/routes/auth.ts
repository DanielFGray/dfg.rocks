import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect } from "effect";
import { authGroup } from "../../shared/httpApi.js";
import { checkRateLimit } from "../services/rateLimiter.js";
import { AuthService } from "../services/authService.js";
import { AuthRouteService } from "../services/authRouteService.js";
import { SessionService } from "../services/sessionService.js";
import { UserService } from "../services/userService.js";
import { csrfCheck, expireSessionCookie, setSessionCookie, responseForCause } from "./raw.js";

function cookieIdFromToken(token: string): string | undefined {
  return token.split(".")[0] || undefined;
}

const authApi = HttpApi.make("dfg").add(authGroup);

export function makeAuthLayer() {
  return HttpApiBuilder.group(authApi, "auth", (handlers) =>
    handlers
      .handle(
        "login",
        Effect.fnUntraced(function* ({ request, payload }) {
          csrfCheck(request.headers);
          yield* checkRateLimit("login", request.headers, 10, 60000);
          const result = yield* AuthService.login(payload);
          const { email } = yield* UserService.primaryEmailForUser(result.user.user_id);
          let response = HttpServerResponse.unsafeJson({
            id: result.user.user_id,
            username: result.user.username,
            name: result.user.name ?? "",
            email,
            role: result.user.role,
            is_verified: result.user.is_verified ?? false,
          });
          response = setSessionCookie(response, result.token, result.expiresAt);
          return response;
        }, Effect.catchAllCause(responseForCause)),
      )
      .handle(
        "magicLink",
        Effect.fnUntraced(function* ({ request, payload }) {
          csrfCheck(request.headers);
          yield* checkRateLimit("magic-link", request.headers, 5, 60000);
          yield* AuthRouteService.generateMagicLink(payload.email);
          return { success: true as const };
        }, Effect.catchAllCause(responseForCause)),
      )
      .handle(
        "verifyMagicLink",
        Effect.fnUntraced(function* ({ request, payload }) {
          csrfCheck(request.headers);
          const session = yield* AuthRouteService.consumeMagicLink(payload.token);
          let response = HttpServerResponse.unsafeJson(session.response);
          response = setSessionCookie(response, session.token, session.expiresAt);
          return response;
        }, Effect.catchAllCause(responseForCause)),
      )
      .handle(
        "logout",
        Effect.fnUntraced(function* ({ request }) {
          csrfCheck(request.headers);
          const token = request.cookies.session;
          const cookieId = token ? cookieIdFromToken(token) : undefined;
          yield* AuthService.logout(cookieId);
          return expireSessionCookie(HttpServerResponse.unsafeJson({ success: true as const }));
        }, Effect.catchAllCause(responseForCause)),
      )
      .handle(
        "forgotPassword",
        Effect.fnUntraced(function* ({ request, payload }) {
          csrfCheck(request.headers);
          yield* AuthService.forgotPassword(payload);
          return { success: true as const };
        }, Effect.catchAllCause(responseForCause)),
      )
      .handle(
        "resetPassword",
        Effect.fnUntraced(function* ({ request, payload }) {
          csrfCheck(request.headers);
          const result = yield* AuthService.resetPassword(payload);
          let response = HttpServerResponse.unsafeJson({
            success: true as const,
          });
          response = setSessionCookie(response, result.token, result.expiresAt);
          return response;
        }, Effect.catchAllCause(responseForCause)),
      )
      .handle(
        "me",
        Effect.fnUntraced(function* ({ request }) {
          const session = yield* SessionService.validateSessionToken(request.cookies.session);
          if (!session) {
            return { user: null };
          }
          return yield* AuthRouteService.me(session.user.id);
        }, Effect.catchAllCause(responseForCause)),
      )
      .handle(
        "resendVerification",
        Effect.fnUntraced(function* ({ request }) {
          csrfCheck(request.headers);
          const session = yield* SessionService.validateSessionToken(request.cookies.session);
          if (!session) {
            return { success: true as const };
          }
          yield* AuthRouteService.resendVerification(session.user.id);
          return { success: true as const };
        }, Effect.catchAllCause(responseForCause)),
      ),
  );
}
