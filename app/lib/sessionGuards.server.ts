import { Effect } from "effect";
import { HttpError } from "../../server/pgErrors.js";
import { SessionService, resolveEffectiveStudent } from "../../server/services/sessionService.js";

export const requireSession = Effect.fnUntraced(function* (token: string | undefined) {
  const session = yield* SessionService.use((sessionService) =>
    sessionService.validateSessionToken(token),
  );
  if (!session) {
    return yield* new HttpError(401, "Unauthorized");
  }
  return session;
});

export const requireAdminSession = Effect.fnUntraced(function* (token: string | undefined) {
  const session = yield* requireSession(token);
  if (session.user.role !== "admin") {
    return yield* new HttpError(403, "Forbidden");
  }
  return session;
});

export { resolveEffectiveStudent };
