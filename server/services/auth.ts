import { Effect, Option, Context, Layer } from "effect";
import { addJob, PgRootDB } from "../db.js";
import { RequestDatabase } from "../requestDatabase.js";
import { sql } from "kysely";
import type { UserRow } from "./users.js";
import { Users } from "./users.js";
import { catchPgErrors, HttpError } from "../pgErrors.js";
import { Sessions } from "./sessions.js";

export class InvalidCredentialsError extends HttpError {
  static new() {
    return new InvalidCredentialsError({ status: 401, message: "Invalid credentials" });
  }
}

export class InvalidTokenError extends HttpError {
  static new() {
    return new InvalidTokenError({ status: 400, message: "Invalid or expired token" });
  }
}

export class AccountLockedError extends HttpError {
  static new(message: string) {
    return new AccountLockedError({ status: 423, message: message });
  }
}

/**
 * Authentication service.
 */
export class Auth extends Context.Service<Auth>()("dfg-rocks/auth", {
  make: Effect.gen(function* () {
    const users = yield* Users;
    const sessions = yield* Sessions;
    const rootDb = yield* PgRootDB;
    const db = rootDb;
    const me = Effect.fn("me")(function* (
      sessionId: string,
      userId: string,
      knownActiveStudentId?: string | null,
    ) {
      const profile = yield* RequestDatabase.use((authDb) =>
        authDb
          .execute(
            authDb
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
          )
          .pipe(
            Effect.head,
            Effect.catchTags({
              NoSuchElementError: () => Effect.succeed(null),
            }),
          ),
      );

      const userResult = profile
        ? {
            id: profile.id,
            username: profile.username,
            name: profile.name ?? "",
            email: profile.email ?? "",
            role: profile.role,
            is_verified: profile.is_verified,
          }
        : null;

      const isParent = userResult?.role === "parent";

      const familyStudents =
        isParent && profile
          ? yield* RequestDatabase.use((authDb) =>
              authDb
                .execute(
                  authDb
                    .selectFrom("app_public.family_memberships as fm_parent")
                    .innerJoin(
                      "app_public.family_memberships as fm_student",
                      "fm_student.family_id",
                      "fm_parent.family_id",
                    )
                    .innerJoin("app_public.users as u", "u.id", "fm_student.user_id")
                    .select(["u.id", "u.username", "u.name", "u.role", "u.is_verified"])
                    .select((eb) =>
                      eb
                        .selectFrom("app_public.user_emails")
                        .select("email")
                        .whereRef("app_public.user_emails.user_id", "=", "u.id")
                        .orderBy("is_primary", "desc")
                        .orderBy("id", "desc")
                        .limit(1)
                        .as("email"),
                    )
                    .where("fm_parent.user_id", "=", userId)
                    .where("fm_student.user_id", "<>", userId)
                    .where("u.role", "=", "student" as const),
                )
                .pipe(Effect.orDie),
            )
          : [];

      const activeStudentId =
        knownActiveStudentId !== undefined
          ? knownActiveStudentId
          : yield* db
              .execute(
                db
                  .selectFrom("app_private.sessions")
                  .select("active_student_id")
                  .where("id", "=", sessionId),
              )
              .pipe(
                Effect.head,
                Effect.option,
                Effect.map((session) =>
                  session._tag === "Some" ? session.value.active_student_id : null,
                ),
              );

      const activeStudent =
        activeStudentId && isParent
          ? yield* RequestDatabase.use((authDb) =>
              authDb
                .execute(
                  authDb
                    .selectFrom("app_public.users")
                    .select(["id", "username", "name"])
                    .where("id", "=", activeStudentId),
                )
                .pipe(Effect.head, Effect.option),
            )
          : null;

      return {
        user: userResult,
        isParent,
        familyStudents: familyStudents.map((s) => ({
          id: s.id,
          username: s.username,
          name: s.name ?? "",
          email: s.email ?? "",
          role: s.role,
          is_verified: s.is_verified,
        })),
        activeStudentId,
        activeStudent:
          activeStudent && activeStudent._tag === "Some"
            ? {
                id: activeStudent.value.id,
                username: activeStudent.value.username,
                name: activeStudent.value.name ?? "",
              }
            : null,
      };
    });
    return {
      login: Effect.fnUntraced(function* ({ id, password }: { id: string; password: string }) {
        const session = yield* rootDb
          .execute(
            rootDb
              .with("s", (qb) =>
                qb
                  .selectFrom((eb) =>
                    eb
                      .fn<{
                        id: string;
                        user_id: string;
                      }>("app_private.login", [eb.val(id), eb.val(password)])
                      .as("s"),
                  )
                  .select(["s.id", "s.user_id"])
                  .where("s.user_id", "is not", null),
              )
              .selectFrom("s")
              .innerJoin("app_public.users as u", "u.id", "s.user_id")
              .select(["s.id", "s.user_id", "u.username", "u.role", "u.name", "u.is_verified"]),
          )
          .pipe(catchPgErrors, Effect.head, Effect.catchNoSuchElement);
        if (Option.isNone(session)) {
          return yield* InvalidCredentialsError.new();
        }

        const createdSession = yield* sessions.issueTokenForSession(session.value.id);

        return { user: session.value, ...createdSession };
      }),

      logout: Effect.fnUntraced(function* (cookieId?: string) {
        if (!cookieId) {
          return;
        }

        yield* sessions.deleteSession(cookieId);
      }),

      forgotPassword: Effect.fnUntraced(function* ({ email }: { email: string }) {
        yield* rootDb.execute(
          rootDb.selectNoFrom((eb) =>
            eb.fn<unknown>("app_public.forgot_password", [eb.val(email)]).as("forgot_password"),
          ),
        );
      }),

      resetPassword: Effect.fnUntraced(function* ({
        token,
        password,
      }: {
        token: string;
        password: string;
      }) {
        const session = yield* rootDb
          .execute(
            rootDb
              .with("uid", (qb) =>
                qb
                  .selectFrom("app_private.user_secrets")
                  .select("user_id")
                  .where("reset_password_token", "=", token),
              )
              .with("s", (qb) =>
                qb
                  .selectFrom((eb) =>
                    eb
                      .fn<{
                        id: string;
                        user_id: string;
                      }>("app_private.reset_password", [
                        eb.selectFrom("uid").select("user_id"),
                        eb.val(token),
                        eb.val(password),
                      ])
                      .as("s"),
                  )
                  .selectAll()
                  .where("s.user_id", "is not", null),
              )
              .selectFrom("s")
              .select(["id", "user_id"]),
          )
          .pipe(catchPgErrors, Effect.head, Effect.catchNoSuchElement);
        if (Option.isNone(session)) {
          return yield* InvalidTokenError.new();
        }

        const freshSession = yield* sessions.issueTokenForSession(session.value.id);

        return { token: freshSession.token, expiresAt: freshSession.expiresAt };
      }),
      generateMagicLink: Effect.fn("generateMagicLink")(function* (email: string) {
        yield* db.execute(
          db.selectNoFrom((eb) =>
            eb
              .fn<unknown>("app_private.generate_magic_link", [sql`${email}::citext`])
              .as("generate_magic_link"),
          ),
        );
      }),

      consumeMagicLink: Effect.fn("consumeMagicLink")(function* (token: string) {
        return yield* db.withTransaction(
          Effect.gen(function* () {
            const user = yield* db
              .execute(
                db
                  .selectFrom(sql<UserRow>`app_private.verify_magic_link(${token})`.as("u"))
                  .selectAll(),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () =>
                    new HttpError({ status: 400, message: "Invalid or expired magic link" }),
                }),
              );
            yield* db.execute(
              db
                .updateTable("app_public.user_emails")
                .set({ is_verified: true })
                .where("user_id", "=", user.id)
                .where("is_verified", "=", false),
            );
            yield* db.execute(
              db
                .updateTable("app_public.users")
                .set({ is_verified: true })
                .where("id", "=", user.id)
                .where("is_verified", "=", false),
            );
            return yield* users.sessionFromUser({
              ...user,
              is_verified: true,
            });
          }),
        );
      }),

      me,

      resendVerification: Effect.fn("resendVerification")(function* (userId: string) {
        const email = yield* RequestDatabase.use((authDb) =>
          authDb
            .execute(
              authDb
                .selectFrom("app_public.user_emails")
                .select("id")
                .where("user_id", "=", userId)
                .where("is_verified", "=", false),
            )
            .pipe(Effect.head, Effect.option),
        );

        if (email._tag === "Some") {
          yield* addJob(db, "user_emails__send_verification", {
            id: email.value.id,
          });
        }
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Layer.mergeAll(Users.layer, Sessions.layer, PgRootDB.layer)),
  );
}
