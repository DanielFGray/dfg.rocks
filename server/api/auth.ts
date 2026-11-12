import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { checkRateLimit } from "../rateLimit.js";
import { AuthService } from "../services/authService.js";
import { SessionService } from "../services/sessionService.js";
import { UserService } from "../services/userService.js";
import { expireSessionCookie, setSessionCookie } from "./raw.js";

const authErrorStatuses = [400, 401, 404, 409, 423, 429, 500] as const;

function adaptAuthHttpApiErrors<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return adaptHttpApiErrors(effect, authErrorStatuses);
}

function cookieIdFromToken(token: string): string | undefined {
  return token.split(".")[0] || undefined;
}

export function makeAuthLayer() {
  return HttpApiBuilder.group(Contract, "auth", (handlers) =>
    handlers
      .handle(
        "login",
        Effect.fnUntraced(function* ({ request, payload }) {
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
          yield* checkRateLimit("magic-link", request.headers);
          yield* AuthService.use((authService) => authService.generateMagicLink(payload.email));
          return { success: true as const };
        }, adaptAuthHttpApiErrors),
      )
      .handle(
        "verifyMagicLink",
        Effect.fnUntraced(function* ({ payload }) {
          const session = yield* AuthService.use((authService) =>
            authService.consumeMagicLink(payload.token),
          );
          let response = HttpServerResponse.jsonUnsafe(session.response);
          response = yield* setSessionCookie(response, session.token, session.expiresAt);
          return response;
        }, adaptAuthHttpApiErrors),
      )
      .handle(
        "logout",
        Effect.fnUntraced(function* ({ request }) {
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
          yield* checkRateLimit("forgot-password", request.headers);
          yield* AuthService.use((authService) => authService.forgotPassword(payload));
          return { success: true as const };
        }, adaptAuthHttpApiErrors),
      )
      .handle(
        "resetPassword",
        Effect.fnUntraced(function* ({ request, payload }) {
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
          const session = yield* SessionService.use((service) =>
            service.validateSessionToken(request.cookies.session),
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
          return yield* AuthService.use((service) =>
            service.me(session.session.id, session.user.id, session.session.active_student_id),
          ).pipe(withAuthContext(session.session.id));
        }, adaptAuthHttpApiErrors),
      )
      .handle(
        "resendVerification",
        Effect.fnUntraced(function* ({ request }) {
          const session = yield* SessionService.use((sessionService) =>
            sessionService.validateSessionToken(request.cookies.session),
          );
          if (!session) {
            return { success: true as const };
          }
          yield* AuthService.use((authService) =>
            authService
              .resendVerification(session.user.id)
              .pipe(withAuthContext(session.session.id)),
          );
          return { success: true as const };
        }, adaptAuthHttpApiErrors),
      ),
  );
}
