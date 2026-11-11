import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpApiSecurity from "effect/http-api/HttpApiSecurity";
import { Context } from "effect";
import type { UserRole } from "../schemas.js";
import {
  BadRequestErrorSchema,
  ForbiddenErrorSchema,
  InternalServerErrorSchema,
  UnauthorizedErrorSchema,
} from "../httpApiErrors.js";

// The guards run before the endpoint decodes its request. A group that uses Session, a role
// guard and Csrf adds them in that reverse order (Csrf, then the role, then Session), because the
// last middleware added runs first: a caller learns 401, then 403, then 400.

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  role: UserRole;
};

export type SessionInfo = {
  id: string;
  cookie_id: string;
  user_id: string;
  active_student_id: string | null;
};

/** A signed-in caller: the session row and its user. */
export type SignedIn = { user: SessionUser; session: SessionInfo };

/** The caller of an endpoint guarded by Session. Only the server provides it. */
export class CurrentSession extends Context.Service<CurrentSession, SignedIn>()(
  "dfg/CurrentSession",
) {}

/** The session cookie, `cookieId.secret`. */
export const sessionCookie = HttpApiSecurity.apiKey({ key: "session", in: "cookie" });

/** Answers 401 unless the session cookie names a live session, and provides CurrentSession. */
export class Session extends HttpApiMiddleware.Service<Session, { provides: CurrentSession }>()(
  "dfg/Session",
  {
    security: { session: sessionCookie },
    error: [UnauthorizedErrorSchema, InternalServerErrorSchema],
  },
) {}

/** Answers 403 unless the caller is an admin. */
export class Admin extends HttpApiMiddleware.Service<Admin, { requires: CurrentSession }>()(
  "dfg/Admin",
  { error: ForbiddenErrorSchema },
) {}

/** Answers 403 unless the caller is an admin or a teacher. */
export class Staff extends HttpApiMiddleware.Service<Staff, { requires: CurrentSession }>()(
  "dfg/Staff",
  { error: ForbiddenErrorSchema },
) {}

/**
 * Answers 400 unless the request has an `X-Requested-With` header. A cross-site form cannot set
 * the header, so a state-changing request with it came from the site's own scripts.
 */
export class Csrf extends HttpApiMiddleware.Service<Csrf>()("dfg/Csrf", {
  error: BadRequestErrorSchema,
}) {}
