import { Effect, Option, Context, Layer } from "effect";
import { withAuthContext, PgRootDB } from "../db.js";
import { HttpError, catchPgErrors } from "../pgErrors.js";
import { SessionService } from "./sessionService.js";
import { sql } from "kysely";

/** A signed-in user's own account: email addresses, deletion, and the active student. */
export class AccountService extends Context.Service<AccountService>()("AccountService", {
  make: Effect.gen(function* () {
    const rootDb = yield* PgRootDB;
    return {
      requestDeleteAccount: Effect.fn("requestDeleteAccount")(function* (sessionId: string) {
        yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db.selectNoFrom((eb) =>
              eb
                .fn<unknown>("app_public.request_account_deletion", [])
                .as("request_account_deletion"),
            ),
          ),
        );
      }),
      confirmDeleteAccount: Effect.fn("confirmDeleteAccount")(function* (
        sessionId: string,
        token: string,
      ) {
        const result = yield* withAuthContext(sessionId, (db) =>
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
      myEmails: Effect.fn("myEmails")(function* (sessionId: string) {
        return yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
              .selectFrom("app_public.user_emails")
              .select(["id", "email", "is_verified", "is_primary", "created_at"])
              .orderBy("is_primary", "desc")
              .orderBy("created_at", "asc"),
          ),
        );
      }),
      addMyEmail: Effect.fn("addMyEmail")(function* (sessionId: string, email: string) {
        return yield* withAuthContext(
          sessionId,
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
                  NoSuchElementError: () => new HttpError(500, "Failed to add email"),
                }),
              );
          }),
        ).pipe(catchPgErrors);
      }),
      deleteMyEmail: Effect.fn("deleteMyEmail")(function* (sessionId: string, emailId: string) {
        yield* withAuthContext(
          sessionId,
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
                  NoSuchElementError: () => new HttpError(404, "Email not found"),
                }),
              );
            if (email.is_primary) {
              return yield* new HttpError(400, "Cannot delete primary email");
            }
            yield* db.execute(db.deleteFrom("app_public.user_emails").where("id", "=", emailId));
          }),
        );
      }),
      makePrimaryEmail: Effect.fn("makePrimaryEmail")(function* (
        sessionId: string,
        emailId: string,
      ) {
        return yield* withAuthContext(
          sessionId,
          Effect.fnUntraced(function* (db) {
            yield* db
              .execute(
                db.selectFrom("app_public.user_emails").select(["id"]).where("id", "=", emailId),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () => new HttpError(404, "Email not found"),
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
                  NoSuchElementError: () => new HttpError(404, "Email not found"),
                }),
              );
            return updated;
          }),
        );
      }),
      resendEmailVerification: Effect.fn("resendEmailVerification")(function* (
        sessionId: string,
        emailId: string,
      ) {
        yield* withAuthContext(
          sessionId,
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
                  NoSuchElementError: () => new HttpError(404, "Email not found"),
                }),
              );
            if (email.is_verified) {
              return yield* new HttpError(400, "Email is already verified");
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
        const familyMembership = yield* withAuthContext(sessionId, (db) =>
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
          return yield* new HttpError(403, "Student is not in your family");
        }

        yield* SessionService.use((sessionService) =>
          sessionService.updateActiveStudent(sessionId, studentId),
        );
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
              NoSuchElementError: () => new HttpError(400, "Invalid or expired verification link"),
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
  static readonly layer = Layer.effect(this, this.make);
}
