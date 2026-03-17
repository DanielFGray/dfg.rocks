import {
  HttpApiBuilder,
  HttpApp,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import { Effect, Layer, Redacted } from "effect";
import { SessionService } from "./sessionService.js";
import { env } from "../assertEnv.js";
import {
  sessionCookie,
  CurrentSession,
  SessionMiddleware,
  Unauthorized,
  Forbidden,
  AuthMiddleware,
  AdminMiddleware,
} from "../../shared/middleware.js";

// Re-export all shared types so existing consumers keep working
export {
  sessionCookie,
  CurrentSession,
  SessionMiddleware,
  Unauthorized,
  Forbidden,
  CurrentUser,
  CurrentAdmin,
  AuthMiddleware,
  AdminMiddleware,
} from "../../shared/middleware.js";
export type {
  SessionUser,
  SessionInfo,
  SessionData,
  AuthenticatedSession,
} from "../../shared/middleware.js";

// === Layer implementations ===

export const SessionMiddlewareLive = Layer.effect(
  SessionMiddleware,
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const noSession = { user: null, session: null } as const;
    return SessionMiddleware.of({
      session: (redactedToken: Redacted.Redacted<string>) => {
        const token = Redacted.value(redactedToken);
        if (!token) return Effect.succeed(noSession);
        return sessionService
          .validateSessionToken(token)
          .pipe(Effect.catchAll(() => Effect.succeed(noSession)));
      },
    });
  }),
);

const validateSession = (sessionService: SessionService, redactedToken: Redacted.Redacted<string>) => {
  const token = Redacted.value(redactedToken);
  if (!token) return Effect.fail(new Unauthorized({ error: "Not authenticated" }));
  return sessionService.validateSessionToken(token).pipe(
    Effect.orDie,
    Effect.flatMap(({ user, session }) =>
      user && session
        ? Effect.succeed({ user, session })
        : Effect.fail(new Unauthorized({ error: "Not authenticated" })),
    ),
  );
};

export const AuthMiddlewareLive = Layer.effect(
  AuthMiddleware,
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    return AuthMiddleware.of({
      session: (redactedToken) => validateSession(sessionService, redactedToken),
    });
  }),
);

export const AdminMiddlewareLive = Layer.effect(
  AdminMiddleware,
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    return AdminMiddleware.of({
      session: (redactedToken) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const csrf = request.headers["x-requested-with"];
          if (!csrf) return yield* new Forbidden({ error: "Missing CSRF header" });

          const { user, session } = yield* validateSession(sessionService, redactedToken).pipe(
            Effect.catchTag("Unauthorized", () => new Forbidden({ error: "Admin access required" })),
          );
          if (user.role !== "admin") return yield* new Forbidden({ error: "Admin access required" });
          return { user, session };
        }),
    });
  }),
);

const isSecure = env.NODE_ENV === "production";

export const setSessionCookie = (token: string, expiresAt: Date) =>
  HttpApiBuilder.securitySetCookie(sessionCookie, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    expires: expiresAt,
  });

export const expireSessionCookie = HttpApp.appendPreResponseHandler(
  (_req, response) =>
    Effect.succeed(
      HttpServerResponse.expireCookie(response, "session", {
        httpOnly: true,
        sameSite: "lax",
        secure: isSecure,
        path: "/",
      }),
    ),
);
