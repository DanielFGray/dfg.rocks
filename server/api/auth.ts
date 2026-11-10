import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect } from "effect";
import { authGroup } from "../../shared/httpApi.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { checkRateLimit } from "../rateLimit.js";
import { AuthService } from "../services/authService.js";
import { AuthRouteService } from "../services/authRouteService.js";
import { SessionService } from "../services/sessionService.js";
import { UserService } from "../services/userService.js";
import { csrfCheck, expireSessionCookie, setSessionCookie } from "./raw.js";

const authErrorStatuses = [400, 401, 404, 409, 423, 429, 500] as const;

function adaptAuthHttpApiErrors<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return adaptHttpApiErrors(effect, authErrorStatuses);
}

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
          yield* csrfCheck(request.headers);
          yield* checkRateLimit("login", request.headers);
          const result = yield* AuthService.use((authService) => authService.login(payload));
          const { email } = yield* UserService.use((userService) =>
            userService.primaryEmailForUser(result.user.user_id),
          );
          let response = HttpServerResponse.jsonUnsafe({
            id: result.user.user_id,
            username: result.user.username,
            name: result.user.name ?? "",
            email,
            role: result.user.role,
            is_verified: result.user.is_verified ?? false,
          });
          response = yield* setSessionCookie(response, result.token, result.expiresAt);
          return response;
        }, adaptAuthHttpApiErrors),
      )
      .handle(
        "magicLink",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* csrfCheck(request.headers);
          yield* checkRateLimit("magic-link", request.headers);
          yield* AuthRouteService.use((authRouteService) =>
            authRouteService.generateMagicLink(payload.email),
          );
          return { success: true as const };
        }, adaptAuthHttpApiErrors),
      )
      .handle(
        "verifyMagicLink",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* csrfCheck(request.headers);
          const session = yield* AuthRouteService.use((authRouteService) =>
            authRouteService.consumeMagicLink(payload.token),
          );
          let response = HttpServerResponse.jsonUnsafe(session.response);
          response = yield* setSessionCookie(response, session.token, session.expiresAt);
          return response;
        }, adaptAuthHttpApiErrors),
      )
      .handle(
        "logout",
        Effect.fnUntraced(function* ({ request }) {
          yield* csrfCheck(request.headers);
          const token = request.cookies.session;
          const cookieId = token ? cookieIdFromToken(token) : undefined;
          yield* AuthService.use((authService) => authService.logout(cookieId));
          return yield* expireSessionCookie(
            HttpServerResponse.jsonUnsafe({ success: true as const }),
          );
        }, adaptAuthHttpApiErrors),
      )
      .handle(
        "forgotPassword",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* csrfCheck(request.headers);
          yield* checkRateLimit("forgot-password", request.headers);
          yield* AuthService.use((authService) => authService.forgotPassword(payload));
          return { success: true as const };
        }, adaptAuthHttpApiErrors),
      )
      .handle(
        "resetPassword",
        Effect.fnUntraced(function* ({ request, payload }) {
          yield* csrfCheck(request.headers);
          yield* checkRateLimit("reset-password", request.headers);
          const result = yield* AuthService.use((authService) =>
            authService.resetPassword(payload),
          );
          let response = HttpServerResponse.jsonUnsafe({
            success: true as const,
          });
          response = yield* setSessionCookie(response, result.token, result.expiresAt);
          return response;
        }, adaptAuthHttpApiErrors),
      )
      .handle(
        "me",
        Effect.fnUntraced(function* ({ request }) {
          const session = yield* SessionService.use((sessionService) =>
            sessionService.validateSessionToken(request.cookies.session),
          );
          if (!session) {
            return {
              user: null,
              isParent: false,
              familyStudents: [],
              activeStudentId: null,
              activeStudent: null,
            };
          }
          return yield* AuthRouteService.use((authRouteService) =>
            authRouteService.me(
              session.session.id,
              session.user.id,
              session.session.active_student_id,
            ),
          );
        }, adaptAuthHttpApiErrors),
      )
      .handle(
        "resendVerification",
        Effect.fnUntraced(function* ({ request }) {
          yield* csrfCheck(request.headers);
          const session = yield* SessionService.use((sessionService) =>
            sessionService.validateSessionToken(request.cookies.session),
          );
          if (!session) {
            return { success: true as const };
          }
          yield* AuthRouteService.use((authRouteService) =>
            authRouteService.resendVerification(session.session.id, session.user.id),
          );
          return { success: true as const };
        }, adaptAuthHttpApiErrors),
      ),
  );
}
