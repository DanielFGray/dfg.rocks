import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { Effect } from "effect";
import { PgRootDB } from "../../server/db.js";
import { serverRuntime } from "../../server/runtime.js";
import { SessionService } from "../../server/services/sessionService.js";

export type AuthUser = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  is_verified: boolean;
};

export const getAuthUser = createServerFn({ method: "GET" }).handler(async () => {
  const token = getCookie("session");
  if (!token) {
    return { user: null };
  }

  const result = await serverRuntime.runPromise(
    Effect.gen(function* () {
      const session = yield* SessionService.validateSessionToken(token);
      if (!session) {
        return null;
      }

      const db = yield* PgRootDB;
      return yield* db
        .selectFrom("app_public.users")
        .select(["id", "username", "name", "role", "is_verified"])
        .select((eb) =>
          eb
            .selectFrom("app_public.user_emails")
            .select("email")
            .whereRef("app_public.user_emails.user_id", "=", "app_public.users.id")
            .where("is_primary", "=", true)
            .limit(1)
            .as("email"),
        )
        .where("id", "=", session.user.id)
        .pipe(
          Effect.head,
          Effect.catchTag("NoSuchElementException", () => Effect.succeed(null)),
        );
    }),
  );

  return {
    user:
      result && {
        id: result.id,
        username: result.username,
        name: result.name ?? "",
        email: result.email ?? "",
        role: result.role,
        is_verified: result.is_verified,
      },
  };
});
