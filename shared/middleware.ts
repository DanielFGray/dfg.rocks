import {
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from "@effect/platform";
import { Context, Schema } from "effect";
import type { UserRole } from "./schemas.js";

export const sessionCookie = HttpApiSecurity.apiKey({
  in: "cookie",
  key: "session",
});

export type SessionUser = {
  readonly id: string;
  readonly username: string;
  readonly role: UserRole;
};

export type SessionInfo = {
  readonly id: string;
  readonly cookie_id: string;
  readonly user_id: string;
};

export type SessionData = {
  readonly user: SessionUser | null;
  readonly session: SessionInfo | null;
};

export class CurrentSession extends Context.Tag("CurrentSession")<
  CurrentSession,
  SessionData
>() {}

export class SessionMiddleware extends HttpApiMiddleware.Tag<SessionMiddleware>()(
  "SessionMiddleware",
  {
    provides: CurrentSession,
    security: { session: sessionCookie },
  },
) {}

// === Auth error types (used by middleware failure channels) ===

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { error: Schema.String },
  HttpApiSchema.annotations({ status: 401 }),
) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  { error: Schema.String },
  HttpApiSchema.annotations({ status: 403 }),
) {}

// === Authenticated user context (non-null, enforced by middleware) ===

export type AuthenticatedSession = {
  readonly user: SessionUser;
  readonly session: SessionInfo;
};

export class CurrentUser extends Context.Tag("CurrentUser")<
  CurrentUser,
  AuthenticatedSession
>() {}

export class CurrentAdmin extends Context.Tag("CurrentAdmin")<
  CurrentAdmin,
  AuthenticatedSession
>() {}

// === AuthMiddleware — enforces logged-in user, provides CurrentUser ===

export class AuthMiddleware extends HttpApiMiddleware.Tag<AuthMiddleware>()(
  "AuthMiddleware",
  {
    failure: Unauthorized,
    provides: CurrentUser,
    security: { session: sessionCookie },
  },
) {}

// === AdminMiddleware — enforces admin role + CSRF, provides CurrentAdmin ===

export class AdminMiddleware extends HttpApiMiddleware.Tag<AdminMiddleware>()(
  "AdminMiddleware",
  {
    failure: Forbidden,
    provides: CurrentAdmin,
    security: { session: sessionCookie },
  },
) {}
