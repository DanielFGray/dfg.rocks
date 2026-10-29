import { Effect } from "effect";
import { sql } from "kysely";
import { PgRootDB, withAuthContext } from "../db.js";
import { HttpError } from "../pgErrors.js";
import type { UserRow } from "./userService.js";
import { UserService } from "./userService.js";
export class AuthRouteService extends Effect.Service<AuthRouteService>()("AuthRouteService", {
  accessors: true,
  effect: Effect.gen(function* () {
    const db = yield* PgRootDB;

    return {
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
                  NoSuchElementException: () => new HttpError(400, "Invalid or expired magic link"),
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
            return yield* UserService.sessionFromUser({
              ...user,
              is_verified: true,
            });
          }),
        );
      }),

      me: Effect.fn("me")(function* (
        sessionId: string,
        userId: string,
        knownActiveStudentId?: string | null,
      ) {
        const profile = yield* withAuthContext(sessionId, (authDb) =>
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
                NoSuchElementException: () => Effect.succeed(null),
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
            ? yield* withAuthContext(sessionId, (authDb) =>
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
            ? yield* withAuthContext(sessionId, (authDb) =>
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
      }),

      resendVerification: Effect.fn("resendVerification")(function* (
        sessionId: string,
        userId: string,
      ) {
        const email = yield* withAuthContext(sessionId, (authDb) =>
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
          yield* db.execute(
            db.selectNoFrom((eb) =>
              eb
                .fn<unknown>("graphile_worker.add_job", [
                  eb.val("user_emails__send_verification"),
                  sql`${JSON.stringify({ id: email.value.id })}::json`,
                ])
                .as("add_job"),
            ),
          );
        }
      }),
    };
  }),
}) {}
