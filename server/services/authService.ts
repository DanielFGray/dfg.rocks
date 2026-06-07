import { sql } from "kysely";
import { Effect, Option } from "effect";
import { PgRootDB } from "../db.js";
import { catchPgErrors, HttpError } from "../pgErrors.js";
import { SessionService } from "./sessionService.js";

export class InvalidCredentialsError extends HttpError {
  constructor() {
    super(401, "Invalid credentials");
  }
}

export class InvalidTokenError extends HttpError {
  constructor() {
    super(400, "Invalid or expired token");
  }
}

export class AccountLockedError extends HttpError {
  constructor(message: string) {
    super(423, message);
  }
}

const loginEffect = Effect.fnUntraced(function* ({
  id,
  password,
}: {
  id: string;
  password: string;
}) {
  const rootDb = yield* PgRootDB;
  const session = yield* rootDb
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
    .select([
      "s.id",
      "s.user_id",
      "u.username",
      "u.role",
      "u.name",
      "u.is_verified",
    ])
    .pipe(catchPgErrors, Effect.head, Effect.optionFromOptional);
  if (Option.isNone(session)) {
    return yield* new InvalidCredentialsError();
  }

  const createdSession = yield* SessionService.issueTokenForSession(session.value.id);

  return { user: session.value, ...createdSession };
});

const logoutEffect = Effect.fnUntraced(function* (cookieId?: string) {
  if (!cookieId) {
    return;
  }

  yield* SessionService.deleteSession(cookieId);
});

const forgotPasswordEffect = Effect.fnUntraced(function* ({
  email,
}: {
  email: string;
}) {
  const rootDb = yield* PgRootDB;
  yield* rootDb.selectNoFrom((eb) =>
    eb
      .fn<unknown>("app_public.forgot_password", [eb.val(email)])
      .as("forgot_password"),
  );
});

const resetPasswordEffect = Effect.fnUntraced(function* ({
  token,
  password,
}: {
  token: string;
  password: string;
}) {
  const rootDb = yield* PgRootDB;
  const session = yield* rootDb
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
              sql`(SELECT user_id FROM uid)::uuid`,
              eb.val(token),
              eb.val(password),
            ])
            .as("s"),
        )
        .selectAll()
        .where("s.user_id", "is not", null),
    )
    .selectFrom("s")
    .select(["id", "user_id"])
    .pipe(catchPgErrors, Effect.head, Effect.optionFromOptional);
  if (Option.isNone(session)) {
    return yield* new InvalidTokenError();
  }

  const freshSession = yield* SessionService.issueTokenForSession(session.value.id);

  return { token: freshSession.token, expiresAt: freshSession.expiresAt };
});

/**
 * Authentication service.
 */
export class AuthService extends Effect.Service<AuthService>()("AuthService", {
  succeed: {
    login: loginEffect,
    logout: logoutEffect,
    forgotPassword: forgotPasswordEffect,
    resetPassword: resetPasswordEffect,
  },
}) {}
