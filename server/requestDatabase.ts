import { Config, Context, Effect } from "effect";
import { sql } from "kysely";
import { type Database, PgAuthDB } from "./db.js";

/** The visitor database connection inside the caller's transaction. */
/** @perRequest: request middleware supplies this value. */
export class RequestDatabase extends Context.Service<RequestDatabase, Database>()(
  "dfg-rocks/requestDatabase",
) {}

/**
 * Binds the visitor role and session for this transaction only. A request with no session passes
 * `undefined`: the visitor then has no user, and row security admits only what anyone may read.
 */
export const withAuthContext =
  (sessionId: string | undefined) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const db = yield* PgAuthDB;
      const databaseVisitor = yield* Config.String("DATABASE_VISITOR");
      return yield* db.withTransaction(
        db
          .execute(
            db.selectNoFrom((eb) => [
              eb
                .fn<void>("set_config", [sql.lit("role"), eb.val(databaseVisitor), eb.lit(true)])
                .as("_1"),
              eb
                .fn<void>("set_config", [
                  sql.lit("my.session_id"),
                  eb.val(sessionId ?? ""),
                  eb.lit(true),
                ])
                .as("_2"),
            ]),
          )
          .pipe(Effect.andThen(effect.pipe(Effect.provideService(RequestDatabase, db)))),
      );
    });
