import { Effect } from "effect";
import { sql } from "kysely";
import { PgRootDB } from "../db.js";
import { HttpError } from "../pgErrors.js";
import type { UserRow } from "./userService.js";
import { UserService } from "./userService.js";
export class AuthRouteService extends Effect.Service<AuthRouteService>()("AuthRouteService", {
  accessors: true,
  effect: Effect.gen(function* () {
    const db = yield* PgRootDB;

    return {
      generateMagicLink: Effect.fn("generateMagicLink")(function* (email: string) {
        yield* db.selectNoFrom((eb) =>
          eb
            .fn<unknown>("app_private.generate_magic_link", [sql`${email}::citext`])
            .as("generate_magic_link"),
        );
      }),

      consumeMagicLink: Effect.fn("consumeMagicLink")(function* (token: string) {
        const user = yield* db
          .selectFrom(sql<UserRow>`app_private.verify_magic_link(${token})`.as("u"))
          .selectAll()
          .pipe(
            Effect.head,
            Effect.catchTag(
              "NoSuchElementException",
              () => new HttpError(400, "Invalid or expired magic link"),
            ),
          );
        yield* db
          .updateTable("app_public.user_emails")
          .set({ is_verified: true })
          .where("user_id", "=", user.id)
          .where("is_verified", "=", false);
        yield* db
          .updateTable("app_public.users")
          .set({ is_verified: true })
          .where("id", "=", user.id)
          .where("is_verified", "=", false);
        return yield* UserService.sessionFromUser({ ...user, is_verified: true });
      }),

      me: Effect.fn("me")(function* (userId: string) {
        const profile = yield* UserService.profileById(userId);
        return {
          user: profile
            ? {
                id: profile.id,
                username: profile.username,
                name: profile.name ?? "",
                email: profile.email ?? "",
                role: profile.role,
                is_verified: profile.is_verified,
              }
            : null,
        };
      }),

      resendVerification: Effect.fn("resendVerification")(function* (userId: string) {
        const email = yield* db
          .selectFrom("app_public.user_emails")
          .select("id")
          .where("user_id", "=", userId)
          .where("is_verified", "=", false)
          .pipe(Effect.head, Effect.option);

        if (email._tag === "Some") {
          yield* db.selectNoFrom((eb) =>
            eb
              .fn<unknown>("graphile_worker.add_job", [
                eb.val("user_emails__send_verification"),
                sql`${JSON.stringify({ id: email.value.id })}::json`,
              ])
              .as("add_job"),
          );
        }
      }),
    };
  }),
}) {}
