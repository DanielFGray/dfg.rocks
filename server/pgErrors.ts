/**
 * Centralized PostgreSQL custom error code handling.
 *
 * Maps custom errcodes raised by SECURITY DEFINER functions to
 * typed HTTP errors. Unknown SQL errors are rethrown as-is.
 */
import { SqlError } from "effect/sql/SqlError";
import { Effect } from "effect";
import * as Schema from "effect/Schema";

export class HttpError extends Schema.TaggedError<HttpError, { readonly brand: unique symbol }>()(
  "HttpError",
  {
    status: Schema.Finite,
    message: Schema.String,
  },
) {}
/** Custom errcodes raised by our SQL functions. */
const pg_errcodes: Record<string, (msg: string) => HttpError> = {
  /** Account locked -- too many failed login/reset attempts */
  LOCKD: (msg) =>
    new HttpError({ status: 423, message: msg || "Account locked -- too many failed attempts" }),
  /** Password too weak (< 8 chars) */
  WEAKP: (msg) =>
    new HttpError({ status: 400, message: msg || "Password is too weak (minimum 8 characters)" }),
  /** Cannot delete -- user is a family parent */
  OWNER: (msg) =>
    new HttpError({
      status: 400,
      message: msg || "Cannot delete account while you are a parent in a family",
    }),
  /** Not found */
  NTFND: (msg) => new HttpError({ status: 404, message: msg || "Not found" }),
  /** Denied -- business rule violation */
  DNIED: (msg) => new HttpError({ status: 400, message: msg || "Operation denied" }),
  /** Email already verified by another account */
  EMTKN: (msg) =>
    new HttpError({ status: 409, message: msg || "An account already uses this email address" }),
  /** Unique violation (duplicate username, email, etc.) */
  23505: (msg) =>
    new HttpError({ status: 409, message: msg || "A record with this value already exists" }),
};

function unwrapSqlError(err: unknown): unknown {
  return err instanceof SqlError && err.cause !== undefined ? err.cause : err;
}

export function pgErrorToHttpError(err: unknown): HttpError | null {
  const unwrapped = unwrapSqlError(err);

  if (unwrapped instanceof HttpError) {
    return unwrapped;
  }

  if (typeof unwrapped === "object" && unwrapped !== null) {
    const cause = unwrapped as {
      code?: unknown;
      message?: unknown;
    };
    if (typeof cause.code !== "string") {
      return null;
    }

    const factory = pg_errcodes[cause.code];
    if (factory) {
      return factory(typeof cause.message === "string" ? cause.message : "");
    }
  }

  return null;
}

export function catchPgErrors<A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | HttpError, R> {
  return self.pipe(
    Effect.mapError((error): E | HttpError => {
      if (error instanceof HttpError) {
        return error;
      }
      return pgErrorToHttpError(error) ?? error;
    }),
  );
}
/**
 * Map a PostgreSQL DatabaseError to an HttpError if the errcode is known,
 * otherwise rethrow the original error.
 */
export function mapPgError(err: unknown): never {
  throw pgErrorToHttpError(err) ?? unwrapSqlError(err);
}
