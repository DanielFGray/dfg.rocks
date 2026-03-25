import { sql } from "kysely";
import { rootDb } from "../db.js";
import { HttpError, mapPgError } from "../pgErrors.js";
import { sessionService } from "./sessionService.js";

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

export const authService = {
  async login({ id, password }: { id: string; password: string }) {
    let session: { id: string; user_id: string; created_at: Date; expires_at: Date };
    try {
      const row = await rootDb
        .selectFrom((eb) =>
          eb
            .fn<{
              id: string;
              user_id: string;
              created_at: Date;
              expires_at: Date;
            }>("app_private.login", [sql`${id}::citext`, eb.val(password)])
            .as("s"),
        )
        .selectAll()
        .where("s.user_id", "is not", null)
        .executeTakeFirst();

      if (!row) throw new InvalidCredentialsError();
      session = row;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      mapPgError(err);
    }

    const user = await rootDb
      .selectFrom("app_public.users")
      .select(["id", "username", "role", "name", "is_verified"])
      .where("id", "=", session.user_id)
      .executeTakeFirst();

    if (!user) throw new InvalidCredentialsError();

    const { token, expiresAt } = await sessionService.createSession(user.id);
    return { user, token, expiresAt };
  },

  async logout(cookieId?: string): Promise<void> {
    if (cookieId) await sessionService.deleteSession(cookieId);
  },

  async forgotPassword({ email }: { email: string }): Promise<void> {
    await sql`select app_public.forgot_password(${email}::citext)`.execute(rootDb);
  },

  async resetPassword({ token, password }: { token: string; password: string }) {
    const secrets = await rootDb
      .selectFrom("app_private.user_secrets")
      .select("user_id")
      .where("reset_password_token", "=", token)
      .executeTakeFirst();

    if (!secrets) throw new InvalidTokenError();

    let session: { id: string; user_id: string; created_at: Date; expires_at: Date };
    try {
      const row = await rootDb
        .selectFrom((eb) =>
          eb
            .fn<{
              id: string;
              user_id: string;
              created_at: Date;
              expires_at: Date;
            }>("app_private.reset_password", [
              sql`${secrets.user_id}::uuid`,
              eb.val(token),
              eb.val(password),
            ])
            .as("s"),
        )
        .selectAll()
        .where("s.user_id", "is not", null)
        .executeTakeFirst();

      if (!row) throw new InvalidTokenError();
      session = row;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      mapPgError(err);
    }

    // Evict all Valkey sessions (PG sessions already deleted by SQL function)
    await sessionService.deleteAllUserSessionsFromCache(session.user_id);

    // Create fresh Valkey-backed session for the user
    const { token: sessionToken, expiresAt } = await sessionService.createSession(session.user_id);
    return { token: sessionToken, expiresAt };
  },
} as const;
