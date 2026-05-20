import Elysia, { t } from "elysia";
import { sql } from "kysely";
import { rootDb } from "../db.js";
import { sessionService } from "../services/sessionService.js";
import { sendEmail } from "../services/emailService.js";
import {
  createAuthorizationRequest,
  decodeOAuthRedirect,
  decodeOAuthState,
  encodeOAuthRedirect,
  encodeOAuthState,
  exchangeAppleCode,
  exchangeGoogleCode,
  getOAuthCookieName,
  getOAuthCookieOptions,
  getOAuthRedirectCookieName,
  getOAuthRedirectTarget,
  verifyAppleIdToken,
} from "../services/oauthService.js";
import { checkRateLimit } from "../services/rateLimiter.js";
import { HttpError, mapPgError } from "../pgErrors.js";
import { env } from "../assertEnv.js";
import type { User, UserRole } from "../../shared/schemas.js";

// === Helpers ===

type UserRow = Readonly<Pick<User, "id" | "username" | "name" | "role" | "is_verified">>;
type UserResponse = Pick<User, "id" | "username" | "name" | "email" | "role" | "is_verified">;

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
    secure: env.NODE_ENV === "production",
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
    role: user.role,
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

async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<Record<string, unknown> & { sub: string }> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new HttpError(502, "Failed to fetch Google user info");
  }

  const userInfo = (await response.json()) as Record<string, unknown>;
  if (typeof userInfo.sub !== "string") {
    throw new HttpError(400, "Google user info is missing subject");
  }

  return {
    ...userInfo,
    sub: userInfo.sub,
  };
}

function parseAppleUserPayload(value: string | undefined): { email?: string; name?: string } {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as {
      email?: unknown;
      name?: { firstName?: unknown; lastName?: unknown };
    };
    const firstName = typeof parsed.name?.firstName === "string" ? parsed.name.firstName : undefined;
    const lastName = typeof parsed.name?.lastName === "string" ? parsed.name.lastName : undefined;
    const name = [firstName, lastName].filter(Boolean).join(" ").trim() || undefined;

    return {
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      name,
    };
  } catch {
    throw new HttpError(400, "Invalid Apple user payload");
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
  .post(
    "/contact",
    async ({ body, headers, set }) => {
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
    },
    {
      body: t.Object({
        name: t.String(),
        email: t.String(),
        phone: t.Optional(t.String()),
        instrument: t.String(),
        format: t.String(),
        message: t.Optional(t.String()),
        website: t.Optional(t.String()),
      }),
    },
  )

  // --- Google OAuth start ---
  .get(
    "/oauth/google",
    ({ query, cookie, redirect, request }) => {
      const rootUrl = new URL(request.url).origin;
      const authorization = createAuthorizationRequest("google", rootUrl, query.redirect);
      const oauthCookieName = getOAuthCookieName("google");
      const redirectCookieName = getOAuthRedirectCookieName("google");
      const cookieOptions = getOAuthCookieOptions("google", rootUrl);

      cookie[oauthCookieName]!.set({
        value: encodeOAuthState(authorization.state),
        ...cookieOptions,
      });
      if (authorization.state.redirect) {
        cookie[redirectCookieName]!.set({
          value: encodeOAuthRedirect(authorization.state.redirect),
          ...cookieOptions,
        });
      } else {
        cookie[redirectCookieName]?.remove();
      }
      return redirect(authorization.url.toString());
    },
    {
      query: t.Object({
        redirect: t.Optional(t.String()),
      }),
    },
  )

  // --- Google OAuth callback ---
  .get(
    "/oauth/google/callback",
    async ({ query, cookie, redirect, request }) => {
      const rootUrl = new URL(request.url).origin;
      const cookieName = getOAuthCookieName("google");
      const redirectCookieName = getOAuthRedirectCookieName("google");
      const oauthState = decodeOAuthState(cookie[cookieName]?.value);
      const redirectTarget = oauthState?.redirect ?? decodeOAuthRedirect(cookie[redirectCookieName]?.value);
      cookie[cookieName]?.remove();
      cookie[redirectCookieName]?.remove();

      if (query.error) {
        throw new HttpError(400, `Google OAuth failed (${query.error})`);
      }
      if (!query.code || !query.state) {
        throw new HttpError(400, "Missing Google OAuth callback parameters");
      }
      if (!oauthState?.codeVerifier || oauthState.state !== query.state) {
        throw new HttpError(400, "Invalid or expired Google OAuth state");
      }

      const tokens = await exchangeGoogleCode(rootUrl, query.code, oauthState.codeVerifier);
      const userInfo = await fetchGoogleUserInfo(tokens.accessToken());

      // Link or register via DB function
      try {
        const user = await rootDb
          .selectFrom(
            sql<UserRow>`app_private.link_or_register_user(
            null,
            'google',
            ${userInfo.sub},
            ${toJson(userInfo)}::json,
            ${toJson(tokens.data)}::json
          )`.as("u"),
          )
          .selectAll()
          .executeTakeFirstOrThrow();

        await sessionFromUser(user, cookie);
        return redirect(new URL(getOAuthRedirectTarget(redirectTarget), request.url).toString());
      } catch (err) {
        if (err instanceof HttpError) throw err;
        mapPgError(err);
      }
    },
    {
      query: t.Object({
        code: t.Optional(t.String()),
        error: t.Optional(t.String()),
        state: t.Optional(t.String()),
      }),
    },
  )

  // --- Apple OAuth start ---
  .get(
    "/oauth/apple",
    ({ query, cookie, redirect, request }) => {
      const rootUrl = new URL(request.url).origin;
      const authorization = createAuthorizationRequest("apple", rootUrl, query.redirect);
      const oauthCookieName = getOAuthCookieName("apple");
      const redirectCookieName = getOAuthRedirectCookieName("apple");
      const cookieOptions = getOAuthCookieOptions("apple", rootUrl);

      cookie[oauthCookieName]!.set({
        value: encodeOAuthState(authorization.state),
        ...cookieOptions,
      });
      if (authorization.state.redirect) {
        cookie[redirectCookieName]!.set({
          value: encodeOAuthRedirect(authorization.state.redirect),
          ...cookieOptions,
        });
      } else {
        cookie[redirectCookieName]?.remove();
      }
      return redirect(authorization.url.toString());
    },
    {
      query: t.Object({
        redirect: t.Optional(t.String()),
      }),
    },
  )

  // --- Apple OAuth callback ---
  .post(
    "/oauth/apple/callback",
    async ({ body, cookie, redirect, request }) => {
      const rootUrl = new URL(request.url).origin;
      const cookieName = getOAuthCookieName("apple");
      const redirectCookieName = getOAuthRedirectCookieName("apple");
      const oauthState = decodeOAuthState(cookie[cookieName]?.value);
      const redirectTarget = oauthState?.redirect ?? decodeOAuthRedirect(cookie[redirectCookieName]?.value);
      cookie[cookieName]?.remove();
      cookie[redirectCookieName]?.remove();

      if (body.error) {
        throw new HttpError(400, `Apple OAuth failed (${body.error})`);
      }
      if (!body.code || !body.state) {
        throw new HttpError(400, "Missing Apple OAuth callback parameters");
      }
      if (!oauthState || oauthState.state !== body.state) {
        throw new HttpError(400, "Invalid or expired Apple OAuth state");
      }

      const tokens = await exchangeAppleCode(rootUrl, body.code);
      const claims = await verifyAppleIdToken(tokens.idToken());
      const appleUser = parseAppleUserPayload(body.user);
      const sub = typeof claims.sub === "string" ? claims.sub : undefined;
      if (!sub) {
        throw new HttpError(400, "Invalid Apple id_token");
      }

      const profile = {
        sub,
        email: typeof claims.email === "string" ? claims.email : appleUser.email,
        name: appleUser.name,
      };

      try {
        const user = await rootDb
          .selectFrom(
            sql<UserRow>`app_private.link_or_register_user(
            null,
            'apple',
            ${sub},
            ${toJson(profile)}::json,
            ${toJson(tokens.data)}::json
          )`.as("u"),
          )
          .selectAll()
          .executeTakeFirstOrThrow();

        await sessionFromUser(user, cookie);
        return redirect(new URL(getOAuthRedirectTarget(redirectTarget), request.url).toString());
      } catch (err) {
        if (err instanceof HttpError) throw err;
        mapPgError(err);
      }
    },
    {
      body: t.Object({
        code: t.Optional(t.String()),
        error: t.Optional(t.String()),
        id_token: t.Optional(t.String()),
        state: t.Optional(t.String()),
        user: t.Optional(t.String()),
      }),
    },
  )

  // --- Verify email ---
  .post(
    "/verify-email",
    async ({ body, headers }) => {
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
    },
    {
      body: t.Object({
        token: t.String(),
      }),
    },
  )

  // --- Get family for invitation ---
  .get(
    "/invitation/:id",
    async ({ params, query }) => {
      const invitation = await rootDb
        .selectFrom("app_public.family_invitations")
        .select(["family_id", "code", "email", "expires_at"])
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

      if (invitation.expires_at && new Date(String(invitation.expires_at)) < new Date()) {
        throw new HttpError(400, "This invitation has expired");
      }

      const family = await rootDb
        .selectFrom("app_public.families")
        .select(["id", "slug", "name", "description", "created_at"])
        .where("id", "=", invitation.family_id)
        .executeTakeFirstOrThrow();

      return {
        ...family,
        created_at: family.created_at.toISOString(),
      };
    },
    {
      query: t.Object({
        code: t.Optional(t.String()),
      }),
    },
  )

  // --- Accept family invitation ---
  .post(
    "/invitation/:id/accept",
    async ({ params, body, headers, cookie }) => {
      csrfCheck(headers);

      const ip = headers["x-forwarded-for"] ?? "unknown";
      checkRateLimit(`accept-invite:${ip}`, 10, 60_000);

      const { code, username, password, name, email, role } = body;

      // Look up and validate invitation
      const invitation = await rootDb
        .selectFrom("app_public.family_invitations")
        .select(["id", "family_id", "code", "expires_at"])
        .where("id", "=", params.id)
        .executeTakeFirst();

      if (!invitation) {
        throw new HttpError(400, "Invitation not found");
      }

      if (invitation.code && invitation.code !== (code ?? "")) {
        throw new HttpError(400, "Invalid invitation code");
      }

      if (invitation.expires_at && new Date(String(invitation.expires_at)) < new Date()) {
        throw new HttpError(400, "This invitation has expired");
      }

      let user: UserRow;
      try {
        user = await rootDb
          .selectFrom(
            sql<UserRow>`app_private.really_create_user(
            ${username}::citext,
            ${name},
            null,
            false,
            ${email || null},
            ${password}
          )`.as("u"),
          )
          .selectAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        if (err instanceof HttpError) throw err;
        mapPgError(err);
      }

      // Set role if provided (defaults to 'student')
      if (role && (role === "parent" || role === "student")) {
        await rootDb
          .updateTable("app_public.users")
          .set({ role: role })
          .where("id", "=", user.id)
          .execute();
        user = { ...user, role };
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
    },
    {
      body: t.Object({
        code: t.Optional(t.String()),
        username: t.String(),
        password: t.String(),
        name: t.String(),
        email: t.Optional(t.String()),
        role: t.Optional(t.String()),
      }),
    },
  );
