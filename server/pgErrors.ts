/**
 * Centralized PostgreSQL custom error code handling.
 *
 * Maps custom errcodes raised by SECURITY DEFINER functions to
 * typed HTTP errors. Other SQL errors pass through unchanged.
 */
import { SqlError } from "effect/sql/SqlError";
import { Effect, Option, Record } from "effect";
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
  23505: () => new HttpError({ status: 409, message: "A record with this value already exists" }),
  /**
   * Foreign key violation: the request is well formed but names a row that does not exist (or no
   * longer exists) now.
   */
  23503: () => new HttpError({ status: 409, message: "This change conflicts with related data" }),
};

/**
 * What Postgres reports about a statement it refused. A `SqlError` holds it two levels down: its
 * `reason` (UnknownError, ConstraintError, ...) keeps the driver's error as `cause`.
 */
const PostgresReport = Schema.Struct({ code: Schema.String, message: Schema.String });

/**
 * The HttpError that a refused query's errcode stands for, if any. A custom code passes the
 * SQL's own message on, which was written for users; a standard code gets fixed text, because
 * Postgres's message can name tables, columns and values. API handlers get it through
 * adaptHttpApiErrors.
 */
export const pgRefusal = (error: SqlError): Option.Option<HttpError> =>
  Option.flatMap(Schema.decodeUnknownOption(PostgresReport)(error.reason.cause), (report) =>
    Option.map(Record.get(pg_errcodes, report.code), (answer) => answer(report.message)),
  );

/** `pgRefusal` over an effect's failures, for a caller that is not an API handler. */
export function catchPgErrors<A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | HttpError, R> {
  return self.pipe(
    Effect.mapError((error): E | HttpError =>
      error instanceof SqlError ? Option.getOrElse(pgRefusal(error), () => error) : error,
    ),
  );
}
