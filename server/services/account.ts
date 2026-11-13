import { Effect, Option, Context, Layer } from "effect";
import { PgRootDB } from "../db.js";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError, catchPgErrors } from "../pgErrors.js";
import { Sessions } from "./sessions.js";
import { sql } from "kysely";

/** A signed-in user's own account: email addresses, deletion, and the active student. */
export class Account extends Context.Service<Account>()("dfg-rocks/account", {
  make: Effect.gen(function* () {
    const sessions = yield* Sessions;
    const rootDb = yield* PgRootDB;
    return {
      requestDeleteAccount: Effect.fn("requestDeleteAccount")(function* () {
        yield* RequestDatabase.use((db) =>
          db.execute(
            db.selectNoFrom((eb) =>
              eb
                .fn<unknown>("app_public.request_account_deletion", [])
                .as("request_account_deletion"),
            ),
          ),
        );
      }),
      confirmDeleteAccount: Effect.fn("confirmDeleteAccount")(function* (token: string) {
        const result = yield* RequestDatabase.use((db) =>
          db
            .execute(
              db.selectNoFrom((eb) =>
                eb
                  .fn<boolean>("app_public.confirm_account_deletion", [eb.val(token)])
                  .as("confirm_account_deletion"),
              ),
            )
            .pipe(Effect.head),
        );
        return result?.confirm_account_deletion ?? false;
      }),
      myEmails: Effect.fn("myEmails")(function* () {
        return yield* RequestDatabase.use((db) =>
          db.execute(
            db
              .selectFrom("app_public.user_emails")
              .select(["id", "email", "is_verified", "is_primary", "created_at"])
              // RLS lets an admin read every user's emails; this list is the caller's own.
              .where("user_id", "=", sql<string>`app_public.current_user_id()`)
              .orderBy("is_primary", "desc")
              .orderBy("created_at", "asc"),
          ),
        );
      }),
      addMyEmail: Effect.fn("addMyEmail")(function* (email: string) {
        return yield* RequestDatabase.use(
          Effect.fnUntraced(function* (db) {
            return yield* db
              .execute(
                db
                  .insertInto("app_public.user_emails")
                  .values({ email })
                  .returning(["id", "email", "is_verified", "is_primary", "created_at"]),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () =>
                    new HttpError({ status: 500, message: "Failed to add email" }),
                }),
              );
          }),
        ).pipe(catchPgErrors);
      }),
      deleteMyEmail: Effect.fn("deleteMyEmail")(function* (emailId: string) {
        yield* RequestDatabase.use(
          Effect.fnUntraced(function* (db) {
            const email = yield* db
              .execute(
                db
                  .selectFrom("app_public.user_emails")
                  .select(["id", "is_primary"])
                  .where("id", "=", emailId),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () =>
                    new HttpError({ status: 404, message: "Email not found" }),
                }),
              );
            if (email.is_primary) {
              return yield* new HttpError({ status: 400, message: "Cannot delete primary email" });
            }
            yield* db.execute(db.deleteFrom("app_public.user_emails").where("id", "=", emailId));
          }),
        );
      }),
      makePrimaryEmail: Effect.fn("makePrimaryEmail")(function* (emailId: string) {
        return yield* RequestDatabase.use(
          Effect.fnUntraced(function* (db) {
            yield* db
              .execute(
                db.selectFrom("app_public.user_emails").select(["id"]).where("id", "=", emailId),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () =>
                    new HttpError({ status: 404, message: "Email not found" }),
                }),
              );
            yield* db.execute(
              db.selectNoFrom((eb) =>
                eb
                  .fn<unknown>("app_public.make_email_primary", [eb.val(emailId)])
                  .as("make_email_primary"),
              ),
            );
            const updated = yield* db
              .execute(
                db
                  .selectFrom("app_public.user_emails")
                  .select(["id", "email", "is_verified", "is_primary", "created_at"])
                  .where("id", "=", emailId),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () =>
                    new HttpError({ status: 404, message: "Email not found" }),
                }),
              );
            return updated;
          }),
        );
      }),
      resendEmailVerification: Effect.fn("resendEmailVerification")(function* (emailId: string) {
        yield* RequestDatabase.use(
          Effect.fnUntraced(function* (db) {
            const email = yield* db
              .execute(
                db
                  .selectFrom("app_public.user_emails")
                  .select(["id", "is_verified"])
                  .where("id", "=", emailId),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () =>
                    new HttpError({ status: 404, message: "Email not found" }),
                }),
              );
            if (email.is_verified) {
              return yield* new HttpError({ status: 400, message: "Email is already verified" });
            }
            yield* db.execute(
              db.selectNoFrom((eb) =>
                eb
                  .fn<unknown>("app_public.resend_email_verification_code", [eb.val(emailId)])
                  .as("resend_email_verification_code"),
              ),
            );
          }),
        );
      }),
      switchActiveStudent: Effect.fnUntraced(function* (
        sessionId: string,
        userId: string,
        studentId: string,
      ) {
        const familyMembership = yield* RequestDatabase.use((db) =>
          db
            .execute(
              db
                .selectFrom("app_public.family_memberships as fm_parent")
                .innerJoin(
                  "app_public.family_memberships as fm_student",
                  "fm_student.family_id",
                  "fm_parent.family_id",
                )
                .select("fm_student.user_id")
                .where("fm_parent.user_id", "=", userId)
                .where("fm_student.user_id", "=", studentId)
                .where("fm_student.user_id", "<>", userId),
            )
            .pipe(Effect.head, Effect.option),
        );

        if (Option.isNone(familyMembership)) {
          return yield* new HttpError({ status: 403, message: "Student is not in your family" });
        }

        yield* sessions.updateActiveStudent(sessionId, studentId);
      }),
      verifyEmail: Effect.fn("verifyEmail")(function* (token: string) {
        const secret = yield* rootDb
          .execute(
            rootDb
              .selectFrom("app_private.user_email_secrets")
              .select("user_email_id")
              .where("verification_token", "=", token),
          )
          .pipe(
            Effect.head,
            Effect.catchTags({
              NoSuchElementError: () =>
                new HttpError({ status: 400, message: "Invalid or expired verification link" }),
            }),
          );
        yield* rootDb
          .execute(
            rootDb.selectNoFrom((eb) =>
              eb
                .fn<unknown>("app_public.verify_email", [
                  sql`${secret.user_email_id}::uuid`,
                  eb.val(token),
                ])
                .as("verify_email"),
            ),
          )
          .pipe(catchPgErrors);
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Layer.mergeAll(Sessions.layer, PgRootDB.layer)),
  );
}
