/**
 * Centralized PostgreSQL custom error code handling.
 *
 * Maps custom errcodes raised by SECURITY DEFINER functions to
 * typed HTTP errors. Unknown SQL errors are rethrown as-is.
 */
import type { DatabaseError } from "pg-protocol";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Custom errcodes raised by our SQL functions. */
const pg_errcodes: Record<string, (msg: string) => HttpError> = {
  /** Account locked -- too many failed login/reset attempts */
  LOCKD: (msg) => new HttpError(423, msg || "Account locked -- too many failed attempts"),
  /** Password too weak (< 8 chars) */
  WEAKP: (msg) => new HttpError(400, msg || "Password is too weak (minimum 8 characters)"),
  /** Cannot delete -- user is a family parent */
  OWNER: (msg) => new HttpError(400, msg || "Cannot delete account while you are a parent in a family"),
  /** Not found */
  NTFND: (msg) => new HttpError(404, msg || "Not found"),
  /** Denied -- business rule violation */
  DNIED: (msg) => new HttpError(400, msg || "Operation denied"),
  /** Unique violation (duplicate username, email, etc.) */
  23505: (msg) => new HttpError(409, msg || "A record with this value already exists"),
};

/**
 * Map a PostgreSQL DatabaseError to an HttpError if the errcode is known,
 * otherwise rethrow the original error.
 */
export function mapPgError(err: unknown): never {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as DatabaseError).code === "string"
  ) {
    const cause = err as DatabaseError;
    const code = cause.code!;
    const factory = pg_errcodes[code];
    if (factory) {
      throw factory(cause.message ?? "");
    }
  }
  throw err;
}
