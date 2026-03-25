import Elysia, { t } from "elysia";
import { sql } from "kysely";
import { decodeJwt } from "jose";
import { rootDb } from "../db.js";
import { sessionService } from "../services/sessionService.js";
import { sendEmail } from "../services/emailService.js";
import { oauthConfig } from "../services/oauthService.js";
import { checkRateLimit } from "../services/rateLimiter.js";
import { HttpError, mapPgError } from "../pgErrors.js";
import { env } from "../assertEnv.js";
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

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function csrfCheck(headers: Record<string, string | undefined>): void {
  if (!headers["x-requested-with"]) {
    throw new HttpError(400, "Missing CSRF header");
  }
}

// === Plugin ===

export const publicRoutes = new Elysia({ prefix: "/api" })
  .onError(({ error, set }) => {
    if (error instanceof HttpError) {
      set.status = error.status;
      return { error: error.message };
    }
  })

  // --- Health ---
  .get("/health", () => ({ success: true as const }))

  // --- Contact ---
  .post("/contact", async ({ body, headers, set }) => {
    csrfCheck(headers);

    const { name, email, phone, instrument, format, message, website } = body;

    // Honeypot
    if (website) {
      set.status = 400;
      return { error: "Invalid submission" };
    }

    const ip = headers["x-forwarded-for"] ?? "unknown";
    checkRateLimit(`contact:${ip}`, 5, 60_000);

    await rootDb
      .insertInto("app_public.contact_submissions")
      .values({
        name,
        email,
        phone: phone ?? null,
        instrument,
        format,
        message: message ?? "",
      })
      .execute();

    await sendEmail({
      to: env.ADMIN_EMAIL,
      subject: `New contact: ${name} (${instrument})`,
      html: `<p><strong>${name}</strong> (${email}) submitted a contact form.</p>
        <p>Instrument: ${instrument} | Format: ${format}</p>
        <p>${message ?? ""}</p>`,
    });

    return { success: true as const };
  }, {
    body: t.Object({
      name: t.String(),
      email: t.String(),
      phone: t.Optional(t.String()),
      instrument: t.String(),
      format: t.String(),
      message: t.Optional(t.String()),
      website: t.Optional(t.String()),
    })
  })

  // --- Google OAuth start ---
  .get("/oauth/google", () => {
    const { clientId, redirectUri } = oauthConfig.google;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
  })

  // --- Google OAuth callback ---
  .get("/oauth/google/callback", async ({ query, cookie }) => {
    const { code } = query;
    if (!code) {
      throw new HttpError(400, "Missing code parameter");
    }

    const { clientId, clientSecret, redirectUri } = oauthConfig.google;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    }).then((r) => r.json());

    const tokenData = tokenRes as Record<string, unknown>;
    if (typeof tokenData.access_token !== "string") {
      throw new HttpError(400, "Token exchange failed");
    }

    // Fetch user info
    const userInfoRes = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    ).then((r) => r.json());

    const userInfo = userInfoRes as Record<string, unknown>;
    if (typeof userInfo.sub !== "string") {
      throw new HttpError(400, "Failed to fetch user info");
    }

    // Link or register via DB function
    try {
      const user = await rootDb
        .selectFrom(
          sql<UserRow>`app_private.link_or_register_user(
            null,
            'google',
            ${userInfo.sub},
            ${toJson(userInfo)}::json,
            ${toJson(tokenData)}::json
          )`.as("u"),
        )
        .selectAll()
        .executeTakeFirstOrThrow();

      return await sessionFromUser(user, cookie);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      mapPgError(err);
    }
  }, {
    query: t.Object({
      code: t.Optional(t.String()),
    })
  })

  // --- Apple OAuth start ---
  .get("/oauth/apple", () => {
    const { clientId, redirectUri } = oauthConfig.apple;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code id_token",
      scope: "name email",
      response_mode: "form_post",
    });
    return { url: `https://appleid.apple.com/auth/authorize?${params}` };
  })

  // --- Apple OAuth callback ---
  .post("/oauth/apple/callback", async ({ body, cookie }) => {
    const { code, id_token: bodyIdToken } = body;

    const { clientId, redirectUri } = oauthConfig.apple;

    // Exchange code for tokens
    const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    }).then((r) => r.json());

    const tokenData = tokenRes as Record<string, unknown>;

    // Decode the id_token JWT (from Apple's response or the POST payload)
    const idToken =
      (typeof tokenData.id_token === "string"
        ? tokenData.id_token
        : bodyIdToken) ?? "";
    if (!idToken) {
      throw new HttpError(400, "No id_token received from Apple");
    }

    const claims = decodeJwt(idToken);
    const sub = claims.sub;
    const email =
      typeof claims.email === "string" ? claims.email : undefined;

    if (!sub) {
      throw new HttpError(400, "Invalid Apple id_token");
    }

    const profile = { sub, email };

    try {
      const user = await rootDb
        .selectFrom(
          sql<UserRow>`app_private.link_or_register_user(
            null,
            'apple',
            ${sub},
            ${toJson(profile)}::json,
            ${toJson(tokenData)}::json
          )`.as("u"),
        )
        .selectAll()
        .executeTakeFirstOrThrow();

      return await sessionFromUser(user, cookie);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      mapPgError(err);
    }
  }, {
    body: t.Object({
      code: t.String(),
      id_token: t.Optional(t.String()),
    })
  })

  // --- Verify email ---
  .post("/verify-email", async ({ body, headers }) => {
    csrfCheck(headers);

    const { token } = body;

    // Look up user_email_id from token
    const secret = await rootDb
      .selectFrom("app_private.user_email_secrets")
      .select("user_email_id")
      .where("verification_token", "=", token)
      .executeTakeFirst();

    if (!secret) {
      throw new HttpError(400, "Invalid or expired verification link");
    }

    await sql`select app_public.verify_email(${secret.user_email_id}::uuid, ${token})`.execute(
      rootDb,
    );

    return { success: true as const };
  }, {
    body: t.Object({
      token: t.String(),
    })
  })

  // --- Get family for invitation ---
  .get("/invitation/:id", async ({ params, query }) => {
    const invitation = await rootDb
      .selectFrom("app_public.family_invitations")
      .select(["family_id", "code", "email"])
      .where("id", "=", params.id)
      .executeTakeFirst();

    if (!invitation) {
      throw new HttpError(404, "Invitation not found");
    }

    // Verify code for email-based invitations
    const queryCode = query.code ?? "";
    if (invitation.code && invitation.code !== queryCode) {
      throw new HttpError(404, "Invalid invitation code");
    }

    const family = await rootDb
      .selectFrom("app_public.families")
      .select(["id", "slug", "name", "description", "created_at"])
      .where("id", "=", invitation.family_id)
      .executeTakeFirstOrThrow();

    return {
      ...family,
      created_at: (family.created_at as Date).toISOString(),
    };
  }, {
    query: t.Object({
      code: t.Optional(t.String()),
    })
  })

  // --- Accept family invitation ---
  .post("/invitation/:id/accept", async ({ params, body, headers, cookie }) => {
    csrfCheck(headers);

    const ip = headers["x-forwarded-for"] ?? "unknown";
    checkRateLimit(`accept-invite:${ip}`, 10, 60_000);

    const { code, username, password, name } = body;

    // Look up and validate invitation
    const invitation = await rootDb
      .selectFrom("app_public.family_invitations")
      .select(["id", "family_id", "code"])
      .where("id", "=", params.id)
      .executeTakeFirst();

    if (!invitation) {
      throw new HttpError(400, "Invitation not found");
    }

    if (invitation.code && invitation.code !== (code ?? "")) {
      throw new HttpError(400, "Invalid invitation code");
    }

    let user: UserRow;
    try {
      // Create user account
      user = await rootDb
        .selectFrom(
          sql<UserRow>`app_private.really_create_user(
            ${username}::citext,
            ${name},
            null,
            true,
            null,
            ${password}
          )`.as("u"),
        )
        .selectAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      mapPgError(err);
    }

    // Add user to family
    await rootDb
      .insertInto("app_public.family_memberships")
      .values({ family_id: invitation.family_id, user_id: user.id })
      .onConflict((oc) => oc.doNothing())
      .execute();

    // Delete the invitation
    await rootDb
      .deleteFrom("app_public.family_invitations")
      .where("id", "=", invitation.id)
      .execute();

    return await sessionFromUser(user, cookie);
  }, {
    body: t.Object({
      code: t.Optional(t.String()),
      username: t.String(),
      password: t.String(),
      name: t.String(),
    })
  });
