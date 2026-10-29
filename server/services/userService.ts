import { Effect, Context, Layer } from "effect";
import type { User } from "../../shared/schemas.js";
import { PgRootDB } from "../db.js";
import { SessionService } from "./sessionService.js";

export type UserRow = Readonly<Pick<User, "id" | "username" | "name" | "role" | "is_verified">>;
export type UserResponse = Pick<
  User,
  "id" | "username" | "name" | "email" | "role" | "is_verified"
>;

export class UserService extends Context.Service<UserService>()("UserService", {
  make: Effect.gen(function* () {
    const db = yield* PgRootDB;

    const primaryEmailForUser = (userId: string) =>
      db.execute(
        db
          .selectFrom("app_public.user_emails")
          .select("email")
          .where("user_id", "=", userId)
          .orderBy("is_primary", "desc")
          .orderBy("is_verified", "desc")
          .orderBy("id", "desc"),
      );

    return {
      primaryEmailForUser: Effect.fn("primaryEmailForUser")(primaryEmailForUser, Effect.head),

      profileById: Effect.fn("profileById")(function* (userId: string) {
        return yield* db.execute(
          db
            .selectFrom("app_public.users")
            .select(["id", "username", "name", "role", "is_verified"])
            .select((eb) =>
              eb
                .selectFrom("app_public.user_emails")
                .select("email")
                .whereRef("app_public.user_emails.user_id", "=", "app_public.users.id")
                .orderBy("is_primary", "desc")
                .orderBy("is_verified", "desc")
                .orderBy("id", "desc")
                .limit(1)
                .as("email"),
            )
            .where("id", "=", userId)
            .limit(1),
        );
      }, Effect.head),

      sessionFromUser: Effect.fn("sessionFromUser")(function* (user: UserRow) {
        const { token, expiresAt } = yield* SessionService.use((sessionService) =>
          sessionService.createSession(user.id),
        );
        const emailResult = yield* primaryEmailForUser(user.id).pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementError: () => Effect.succeed({ email: "" }),
          }),
        );
        const email = emailResult.email;

        return {
          response: {
            id: user.id,
            username: user.username,
            name: user.name ?? "",
            email,
            role: user.role,
            is_verified: user.is_verified,
          } satisfies UserResponse,
          token,
          expiresAt,
        };
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
