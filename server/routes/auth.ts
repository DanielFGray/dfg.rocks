import Elysia, { t } from "elysia";
import { sql } from "kysely";
import { rootDb } from "../db.js";
import { sessionService } from "../services/sessionService.js";
import { authService } from "../services/authService.js";
import { checkRateLimit } from "../services/rateLimiter.js";
import { HttpError } from "../pgErrors.js";
import type { UserRole } from "../../shared/schemas.js";

// === Helpers ===

type UserRow = {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly role: string;
  readonly is_verified: boolean;
};

type UserResponse = {
  id: string;
  username: string;
  name: string;
  email: string;
  role: UserRole;
  is_verified: boolean;
};

async function primaryEmailForUser(userId: string): Promise<string> {
  const row = await rootDb
    .selectFrom("app_public.user_emails")
    .select("email")
    .where("user_id", "=", userId)
    .where("is_primary", "=", true)
    .limit(1)
    .executeTakeFirst();
  return row?.email ?? "";
}

function setSessionCookie(
  cookie: Record<string, { set: (opts: Record<string, unknown>) => unknown }>,
  token: string,
  expiresAt: Date,
): void {
  cookie.session!.set({
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

function expireSessionCookie(
  cookie: Record<string, { set: (opts: Record<string, unknown>) => unknown }>,
): void {
  cookie.session!.set({
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

async function sessionFromUser(
  user: UserRow,
  cookie: Record<string, { set: (opts: Record<string, unknown>) => unknown }>,
): Promise<UserResponse> {
  const { token, expiresAt } = await sessionService.createSession(user.id);
  setSessionCookie(cookie, token, expiresAt);
  const email = await primaryEmailForUser(user.id);
  return {
    id: user.id,
    username: user.username,
    name: user.name ?? "",
    email,
    role: user.role as UserRole,
    is_verified: user.is_verified,
  };
}

function csrfCheck(headers: Record<string, string | undefined>): void {
  if (!headers["x-requested-with"]) {
    throw new HttpError(400, "Missing CSRF header");
  }
}

/** Extract the cookie_id portion (before the dot) from a session token. */
function cookieIdFromToken(token: string): string | undefined {
  return token.split(".")[0] || undefined;
}

// === Plugin ===

export const authRoutes = new Elysia({ prefix: "/api" })
  .onError(({ error, set }) => {
    if (error instanceof HttpError) {
      set.status = error.status;
      return { error: error.message };
    }
  })

  // --- Login ---
  .post("/login", async ({ body, headers, cookie }) => {
    csrfCheck(headers);

    const ip = headers["x-forwarded-for"] ?? "unknown";
    checkRateLimit(`login:${ip}`, 10, 60_000);

    const { id, password } = body;
    const result = await authService.login({ id, password });

    setSessionCookie(cookie, result.token, result.expiresAt);

    const email = await primaryEmailForUser(result.user.id);
    return {
      id: result.user.id,
      username: result.user.username,
      name: result.user.name ?? "",
      email,
      role: result.user.role as UserRole,
      is_verified: result.user.is_verified ?? false,
    };
  }, {
    body: t.Object({
      id: t.String(),
      password: t.String(),
    })
  })

  // --- Request magic link ---
  .post("/magic-link", async ({ body, headers }) => {
    csrfCheck(headers);

    const ip = headers["x-forwarded-for"] ?? "unknown";
    checkRateLimit(`magic-link:${ip}`, 5, 60_000);

    const { email } = body;
    await sql`select app_private.generate_magic_link(${email}::citext)`.execute(
      rootDb,
    );

    return { success: true as const };
  }, {
    body: t.Object({
      email: t.String(),
    })
  })

  // --- Verify magic link ---
  .post("/magic-link/verify", async ({ body, headers, cookie }) => {
    csrfCheck(headers);

    const { token } = body;

    const user = await rootDb
      .selectFrom(
        sql<UserRow>`app_private.verify_magic_link(${token})`.as("u"),
      )
      .selectAll()
      .executeTakeFirst();

    if (!user) {
      throw new HttpError(400, "Invalid or expired magic link");
    }

    // Magic link proves email ownership -- mark user + email as verified
    await rootDb
      .updateTable("app_public.user_emails")
      .set({ is_verified: true })
      .where("user_id", "=", user.id)
      .where("is_verified", "=", false)
      .execute();

    await rootDb
      .updateTable("app_public.users")
      .set({ is_verified: true })
      .where("id", "=", user.id)
      .where("is_verified", "=", false)
      .execute();

    return await sessionFromUser({ ...user, is_verified: true }, cookie);
  }, {
    body: t.Object({
      token: t.String(),
    })
  })

  // --- Logout ---
  .post("/logout", async ({ headers, cookie }) => {
    csrfCheck(headers);

    const token = cookie.session?.value as string | undefined;
    const cookieId = token ? cookieIdFromToken(token) : undefined;
    await authService.logout(cookieId);
    expireSessionCookie(cookie);

    return { success: true as const };
  })

  // --- Forgot password ---
  .post("/forgot-password", async ({ body, headers }) => {
    csrfCheck(headers);

    const { email } = body;
    await authService.forgotPassword({ email });

    return { success: true as const };
  }, {
    body: t.Object({
      email: t.String(),
    })
  })

  // --- Reset password ---
  .post("/reset-password", async ({ body, headers, cookie }) => {
    csrfCheck(headers);

    const { token, password } = body;
    const result = await authService.resetPassword({ token, password });

    setSessionCookie(cookie, result.token, result.expiresAt);

    return { success: true as const };
  }, {
    body: t.Object({
      token: t.String(),
      password: t.String(),
    })
  })

  // --- Me (current user, nullable) ---
  .get("/me", async ({ cookie }) => {
    const token = cookie.session?.value as string | undefined;
    const session = await sessionService.validateSessionToken(token);

    if (!session) return { user: null };

    const profile = await rootDb
      .selectFrom("app_public.users")
      .select(["id", "username", "name", "role", "is_verified"])
      .select((eb) =>
        eb
          .selectFrom("app_public.user_emails")
          .select("email")
          .whereRef(
            "app_public.user_emails.user_id",
            "=",
            "app_public.users.id",
          )
          .where("is_primary", "=", true)
          .limit(1)
          .as("email"),
      )
      .where("id", "=", session.user.id)
      .executeTakeFirst();

    return {
      user: profile
        ? {
            id: profile.id,
            username: profile.username,
            name: profile.name ?? "",
            email: profile.email ?? "",
            role: profile.role as UserRole,
            is_verified: profile.is_verified,
          }
        : null,
    };
  })

  // --- Resend verification email ---
  .post("/resend-verification", async ({ headers, cookie }) => {
    csrfCheck(headers);

    const token = cookie.session?.value as string | undefined;
    const session = await sessionService.validateSessionToken(token);

    if (!session) return { success: true as const };

    // Find an unverified email for this user and trigger re-send
    const emailRow = await rootDb
      .selectFrom("app_public.user_emails")
      .select("id")
      .where("user_id", "=", session.user.id)
      .where("is_verified", "=", false)
      .limit(1)
      .executeTakeFirst();

    if (emailRow) {
      await sql`select graphile_worker.add_job('user_emails__send_verification', ${JSON.stringify({ id: emailRow.id })}::json)`.execute(
        rootDb,
      );
    }

    return { success: true as const };
  });
