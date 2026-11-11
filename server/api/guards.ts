import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { Effect, Layer, Redacted } from "effect";
import { Admin, Csrf, CurrentSession, Session, Staff } from "../../shared/api/guards.js";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "../../shared/httpApiErrors.js";
import type { UserRole } from "../../shared/schemas.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { PgRootDB } from "../db.js";
import { SessionService } from "../services/sessionService.js";

/** The server side of the contract's guards (shared/api/guards.ts). */
export const GuardsLive = Layer.mergeAll(
  Layer.effect(
    Session,
    Effect.gen(function* () {
      const sessions = yield* SessionService;
      // Middleware may need only request services, so the lookup gets the pool now.
      const rootDb = yield* PgRootDB;
      return {
        session: (httpEffect, { credential }) =>
          sessions.validateSessionToken(Redacted.value(credential)).pipe(
            Effect.provideService(PgRootDB, rootDb),
            Effect.flatMap((session) =>
              session === null
                ? Effect.fail(new UnauthorizedError({ error: "Unauthorized" }))
                : Effect.succeed(session),
            ),
            // A lookup that fails for another reason is logged and answers 500.
            (lookup) => adaptHttpApiErrors(lookup, [401, 500] as const),
            Effect.flatMap((session) => Effect.provideService(httpEffect, CurrentSession, session)),
          ),
      };
    }),
  ),
  Layer.succeed(Admin, requireRole(["admin"])),
  Layer.succeed(Staff, requireRole(["admin", "teacher"])),
  Layer.succeed(Csrf, (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (!request.headers["x-requested-with"]) {
        return yield* new BadRequestError({ error: "Missing CSRF header" });
      }
      return yield* httpEffect;
    }),
  ),
);

function requireRole(allowed: ReadonlyArray<UserRole>) {
  return <A, E, R>(httpEffect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const { user } = yield* CurrentSession;
      if (!allowed.includes(user.role)) {
        return yield* new ForbiddenError({ error: "Forbidden" });
      }
      return yield* httpEffect;
    });
}
