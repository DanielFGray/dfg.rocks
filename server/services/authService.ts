import { Effect, Schema as S } from "effect";
import { sql } from "kysely";
import crypto from "crypto";
import { PgRootDB } from "../db.js";
import { SessionService } from "./sessionService.js";
import { EmailService } from "./emailService.js";
import { env } from "../assertEnv.js";

export class InvalidCredentialsError extends S.TaggedError<InvalidCredentialsError>()(
  "InvalidCredentials",
  { message: S.String },
) {}

export class InvalidTokenError extends S.TaggedError<InvalidTokenError>()(
  "InvalidToken",
  { message: S.String },
) {}

export class DuplicateAccountError extends S.TaggedError<DuplicateAccountError>()(
  "DuplicateAccount",
  { message: S.String },
) {}

export class AccountLockedError extends S.TaggedError<AccountLockedError>()(
  "AccountLockedError",
  { message: S.String },
) {}

export class AuthService extends Effect.Service<AuthService>()("AuthService", {
  effect: Effect.gen(function* () {
    const rootDb = yield* PgRootDB;
    const sessionService = yield* SessionService;
    const emailService = yield* EmailService;

    return {
      login: ({ id, password }: { id: string; password: string }) =>
        Effect.gen(function* () {
          const user = yield* rootDb
            .selectFrom((eb) =>
              eb
                .fn<{
                  id: string;
                  username: string;
                  role: string;
                  email: string;
                  name: string;
                }>("app_private.login", [sql`${id}::citext`, eb.val(password)])
                .as("u"),
            )
            .selectAll()
            .where("u.id", "is not", null)
            .pipe(
              Effect.head,
              Effect.catchTag("SqlError", (e) =>
                (e.cause as any)?.code === "LOCKD"
                  ? Effect.fail(new AccountLockedError({ message: (e.cause as any)?.message ?? "Account locked" }))
                  : Effect.die(e),
              ),
              Effect.catchTag("NoSuchElementException", () =>
                Effect.fail(
                  new InvalidCredentialsError({ message: "Invalid credentials" }),
                ),
              ),
            );

          const { token, expiresAt } = yield* sessionService.createSession(
            user.id,
          );
          return { user, token, expiresAt };
        }),

      logout: (cookieId: string | undefined) =>
        Effect.gen(function* () {
          if (cookieId) yield* sessionService.deleteSession(cookieId);
          return { success: true as const };
        }),

      createStudent: (opts: {
        username: string;
        email: string;
        name: string;
      }) =>
        Effect.gen(function* () {
          const user = yield* rootDb
            .selectFrom(
              sql<{
                id: string;
                username: string;
                email: string;
                name: string;
                role: string;
              }>`
                app_private.create_user(
                  ${opts.username}::citext,
                  ${opts.email}::citext,
                  ${opts.name},
                  'student'::app_public.user_role
                )
              `.as("u"),
            )
            .selectAll()
            .pipe(
              Effect.head,
              Effect.catchTag("NoSuchElementException", () =>
                Effect.die(new Error("create_user returned no rows")),
              ),
            );

          const inviteToken = crypto.randomBytes(32).toString("hex");
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

          yield* rootDb
            .updateTable("app_private.user_secrets")
            .set({
              invite_token: inviteToken,
              invite_token_expires_at: expiresAt,
            })
            .where("user_id", "=", user.id);

          const inviteUrl = `${env.VITE_ROOT_URL}/set-password?token=${inviteToken}`;
          yield* emailService.send({
            to: opts.email,
            subject: "Welcome to DFG Portal",
            html: `<p>Hi ${opts.name},</p><p>You've been invited to the DFG student portal. <a href="${inviteUrl}">Click here to set your password</a>.</p><p>This link expires in 7 days.</p>`,
          });

          return user;
        }),

      setPassword: ({ token, password }: { token: string; password: string }) =>
        Effect.gen(function* () {
          const secrets = yield* rootDb
            .selectFrom("app_private.user_secrets")
            .select(["user_id", "invite_token_expires_at"])
            .where("invite_token", "=", token)
            .pipe(
              Effect.head,
              Effect.catchTag("NoSuchElementException", () =>
                Effect.fail(
                  new InvalidTokenError({ message: "Invalid or expired token" }),
                ),
              ),
            );

          if (
            !secrets.invite_token_expires_at ||
            secrets.invite_token_expires_at < new Date()
          ) {
            return yield* Effect.fail(
              new InvalidTokenError({ message: "Token expired" }),
            );
          }

          yield* rootDb.selectNoFrom([
            sql`app_private.set_password(${secrets.user_id}::uuid, ${password})`.as("_"),
          ]);

          yield* rootDb
            .updateTable("app_private.user_secrets")
            .set({ invite_token: null, invite_token_expires_at: null })
            .where("user_id", "=", secrets.user_id);

          const { token: sessionToken, expiresAt } =
            yield* sessionService.createSession(secrets.user_id);
          return { token: sessionToken, expiresAt };
        }),

      forgotPassword: ({ email }: { email: string }) =>
        Effect.gen(function* () {
          const user = yield* rootDb
            .selectFrom("app_public.users")
            .select(["id", "email", "name"])
            .where("email", "=", email)
            .pipe(
              Effect.head,
              Effect.catchTag("NoSuchElementException", () => Effect.void),
            );

          if (!user) return;

          const resetToken = crypto.randomBytes(32).toString("hex");
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

          yield* rootDb
            .updateTable("app_private.user_secrets")
            .set({
              reset_password_token: resetToken,
              reset_password_token_expires_at: expiresAt,
            })
            .where("user_id", "=", user.id);

          const resetUrl = `${env.VITE_ROOT_URL}/reset-password?token=${resetToken}`;
          yield* emailService.send({
            to: user.email,
            subject: "Reset your password",
            html: `<p>Hi ${user.name},</p><p><a href="${resetUrl}">Click here to reset your password</a>.</p><p>This link expires in 1 hour.</p>`,
          });
        }),

      resetPassword: ({ token, password }: { token: string; password: string }) =>
        Effect.gen(function* () {
          const secrets = yield* rootDb
            .selectFrom("app_private.user_secrets")
            .select(["user_id", "reset_password_token_expires_at"])
            .where("reset_password_token", "=", token)
            .pipe(
              Effect.head,
              Effect.catchTag("NoSuchElementException", () =>
                Effect.fail(
                  new InvalidTokenError({ message: "Invalid or expired token" }),
                ),
              ),
            );

          if (
            !secrets.reset_password_token_expires_at ||
            secrets.reset_password_token_expires_at < new Date()
          ) {
            return yield* Effect.fail(
              new InvalidTokenError({ message: "Token expired" }),
            );
          }

          yield* rootDb.selectNoFrom([
            sql`app_private.set_password(${secrets.user_id}::uuid, ${password})`.as("_"),
          ]);

          yield* rootDb
            .updateTable("app_private.user_secrets")
            .set({
              reset_password_token: null,
              reset_password_token_expires_at: null,
            })
            .where("user_id", "=", secrets.user_id);

          const { token: sessionToken, expiresAt } =
            yield* sessionService.createSession(secrets.user_id);
          return { token: sessionToken, expiresAt };
        }),
    } as const;
  }),
  dependencies: [PgRootDB.Live, SessionService.Default, EmailService.Default],
  accessors: true,
}) {}
