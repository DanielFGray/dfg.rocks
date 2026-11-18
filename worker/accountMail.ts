import { Array as Arr, Config, Context, Effect, Layer, Match, Option, Schema } from "effect";
import { addJob, PgRootDB } from "../server/db.js";
import type { QueuedEmail } from "./email/mailKinds.js";

/** Account notifications from the database's queued events. */
export class AccountMail extends Context.Service<AccountMail>()("dfg-rocks/accountMail", {
  make: Effect.gen(function* () {
    const db = yield* PgRootDB;
    const queue = (email: QueuedEmail) => addJob(db, "send_email", email).pipe(Effect.asVoid);
    const user = (id: string) =>
      db
        .execute(
          db
            .selectFrom("app_public.users")
            .select(["created_at", "name", "username"])
            .where("id", "=", id),
        )
        .pipe(Effect.head, Effect.option);
    return {
      audit: Effect.fn("AccountMail.audit")(function* (event: AuditEvent, queuedAt: Date) {
        const found = yield* user(event.user_id);
        if (Option.isNone(found)) return yield* Effect.logWarning("Audit user no longer exists");
        // Registration queues its first address in the transaction that creates the user.
        if (Math.abs(new Date(found.value.created_at).getTime() - queuedAt.getTime()) < 2) return;
        const emails = yield* db.execute(
          db
            .selectFrom("app_public.user_emails")
            .select("email")
            .where("user_id", "=", event.user_id)
            .where("is_verified", "=", true)
            .orderBy("id"),
        );
        const to = emails.map((row) => row.email);
        if (!Arr.isReadonlyArrayNonEmpty(to))
          return yield* new NoVerifiedEmail({ userId: event.user_id });
        const description = describe(event);
        yield* queue({
          options: { to, subject: description.subject },
          template: "account_activity.mjml",
          variables: {
            userName: found.value.name || found.value.username,
            eventDescription: description.actionDescription,
            eventTime: queuedAt.toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          },
        });
      }),
      forgotPassword: Effect.fn("AccountMail.forgotPassword")(function* (
        event: typeof ForgotPassword.Type,
      ) {
        if (Option.isNone(yield* user(event.id)))
          return yield* Effect.logWarning("Password-reset user no longer exists");
        yield* queue({
          options: { to: event.email, subject: "Password reset" },
          template: "password_reset.mjml",
          variables: {
            token: event.token,
            resetLink: `${yield* rootUrl}/reset-password?token=${encodeURIComponent(event.token)}`,
          },
        });
      }),
      magicLink: Effect.fn("AccountMail.magicLink")(function* (event: typeof MagicLink.Type) {
        if (Option.isNone(yield* user(event.id)))
          return yield* Effect.logWarning("Magic-link user no longer exists");
        yield* queue({
          options: { to: event.email, subject: "Your magic login link" },
          template: "magic_link.mjml",
          variables: {
            token: event.token,
            loginLink: `${yield* rootUrl}/magic-login?token=${encodeURIComponent(event.token)}`,
          },
        });
      }),
      forgotPasswordUnregistered: Effect.fn("AccountMail.forgotPasswordUnregistered")(function* (
        event: typeof ForgotPasswordUnregistered.Type,
      ) {
        yield* queue({
          options: { to: event.email, subject: "Password reset attempt" },
          template: "password_reset_unregistered.mjml",
          variables: { email: event.email },
        });
      }),
      sendDeleteAccount: Effect.fn("AccountMail.sendDeleteAccount")(function* (
        event: typeof DeleteAccount.Type,
      ) {
        yield* queue({
          options: { to: event.email, subject: "Confirm account deletion" },
          template: "delete_account.mjml",
          variables: {
            token: event.token,
            deleteLink: `${yield* rootUrl}/confirm-delete-account?token=${encodeURIComponent(event.token)}`,
          },
        });
      }),
      sendVerification: Effect.fn("AccountMail.sendVerification")(function* (
        event: typeof SendVerification.Type,
      ) {
        const found = yield* db
          .execute(
            db
              .selectFrom("app_public.user_emails as email")
              .innerJoin(
                "app_private.user_email_secrets as secret",
                "secret.user_email_id",
                "email.id",
              )
              .select(["email.email", "secret.verification_token"])
              .where("email.id", "=", event.id)
              .where("email.is_verified", "=", false),
          )
          .pipe(Effect.head, Effect.option);
        if (Option.isNone(found) || !found.value.verification_token)
          return yield* Effect.logWarning("Unverified address or token no longer exists");
        const token = found.value.verification_token;
        yield* queue({
          options: { to: found.value.email, subject: "Verify your email address" },
          template: "verify_email.mjml",
          variables: {
            token,
            verifyLink: `${yield* rootUrl}/verify-email?token=${encodeURIComponent(token)}`,
          },
        });
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(PgRootDB.layer));
}

const PasswordEvent = <T extends string>(type: T) =>
  Schema.Struct({ type: Schema.Literal(type), user_id: Schema.String });
const RowEvent = <T extends string>(type: T) =>
  Schema.Struct({
    type: Schema.Literal(type),
    user_id: Schema.String,
    extra1: Schema.String,
    extra2: Schema.String,
  });
export const AuditEvent = Schema.Union([
  RowEvent("added_email"),
  RowEvent("removed_email"),
  RowEvent("linked_account"),
  RowEvent("unlinked_account"),
  PasswordEvent("reset_password"),
  PasswordEvent("change_password"),
]);
export type AuditEvent = typeof AuditEvent.Type;
export const ForgotPassword = Schema.Struct({
  id: Schema.String,
  email: Schema.NonEmptyString,
  token: Schema.NonEmptyString,
});
export const MagicLink = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  token: Schema.String,
});

export const ForgotPasswordUnregistered = Schema.Struct({ email: Schema.NonEmptyString });
export const DeleteAccount = Schema.Struct({
  email: Schema.NonEmptyString,
  token: Schema.NonEmptyString,
});
export const SendVerification = Schema.Struct({ id: Schema.String });
export class NoVerifiedEmail extends Schema.TaggedError<
  NoVerifiedEmail,
  { readonly brand: unique symbol }
>()("NoVerifiedEmail", {
  userId: Schema.String,
}) {}
const rootUrl = Config.NonEmptyString("VITE_ROOT_URL");

const describe = Match.type<AuditEvent>().pipe(
  Match.discriminatorsExhaustive("type")({
    added_email: ({ extra2 }) => ({
      subject: "You added an email to your account",
      actionDescription: `You added the email '${extra2}' to your account.`,
    }),
    removed_email: ({ extra2 }) => ({
      subject: "You removed an email from your account",
      actionDescription: `You removed the email '${extra2}' from your account.`,
    }),
    linked_account: ({ extra1 }) => ({
      subject: "You linked a third-party OAuth provider to your account",
      actionDescription: `You linked a third-party OAuth provider ('${extra1}') to your account.`,
    }),
    unlinked_account: ({ extra1 }) => ({
      subject: "You removed a link between your account and a third-party OAuth provider",
      actionDescription: `You removed a link between your account and a third-party OAuth provider ('${extra1}').`,
    }),
    reset_password: () => ({
      subject: "You reset your password",
      actionDescription: "You reset your password.",
    }),
    change_password: () => ({
      subject: "You changed your password",
      actionDescription: "You changed your password.",
    }),
  }),
);
