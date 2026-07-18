import { Effect } from "effect";
import { HttpError } from "../../server/pgErrors.js";
import { SessionService } from "../../server/services/sessionService.js";

export const requireSession = (token: string | undefined) =>
  Effect.gen(function* () {
    const session = yield* SessionService.validateSessionToken(token);
    if (!session) {
      return yield* HttpError.make(401, "Unauthorized");
    }
    return session;
  });

export const requireAdminSession = (token: string | undefined) =>
  Effect.gen(function* () {
    const session = yield* requireSession(token);
    if (session.user.role !== "admin") {
      return yield* HttpError.make(403, "Forbidden");
    }
    return session;
  });
