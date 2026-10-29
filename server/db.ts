import { PgClient } from "@effect/sql-pg";
import * as SqlClient from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Context, Config, Schedule, Layer, Duration } from "effect";
import {
  type CompiledQuery,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from "kysely";
import { EventEmitter } from "node:events";
import pg from "pg";

EventEmitter.defaultMaxListeners = 20;
import type { DB } from "../generated/db.js";

pg.types.setTypeParser(20, (val: string) => Number(val));

/** Anything Kysely can compile: query builders and `sql` template expressions. */
export interface Compilable<O> {
  compile(): CompiledQuery<O>;
}

/**
 * Kysely builds and compiles queries; the Effect SQL client runs them. Running
 * through the client keeps queries inside Effect transactions, which
 * `withAuthContext` needs for its per-transaction `set_config`.
 *
 * Kysely's own `.execute()` methods are left unusable on purpose: the driver
 * rejects every connection, so a query that bypasses `execute` fails loudly
 * instead of running outside the transaction.
 */
export class Database<T = DB> extends Kysely<T> {
  constructor(private readonly client: SqlClient.SqlClient) {
    super({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new RejectingDriver(),
        createIntrospector: (db) => new PostgresIntrospector(db),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    });
  }

  /** Runs a compiled query and returns its rows. */
  execute<O extends object>(query: Compilable<O>): Effect.Effect<ReadonlyArray<O>, SqlError> {
    const { sql: text, parameters } = query.compile();
    return this.client.unsafe<O>(text, parameters);
  }

  withTransaction<A, E, R>(effect: Effect.Effect<A, E, R>) {
    return this.client.withTransaction(effect);
  }
}

class RejectingDriver extends DummyDriver {
  override acquireConnection(): never {
    throw new Error("Run queries with Database.execute, not Kysely's execute");
  }
}

const withDatabaseRetry = <E, A, R>(layer: Layer.Layer<E, A, R>) =>
  Layer.retry(
    layer,
    Schedule.identity<Layer.Layer.Error<typeof layer>>().pipe(
      Schedule.check(
        (input) =>
          input && typeof input === "object" && "_tag" in input && input._tag === "SqlError",
      ),
      Schedule.intersect(Schedule.exponential("100 millis")),
      Schedule.intersect(Schedule.forever),
      Schedule.jittered,
      Schedule.onDecision(([[_error, duration], attempt], decision) =>
        decision._tag === "Continue"
          ? Effect.logInfo(
              `Retrying database connection in ${Duration.format(duration)} (attempt #${++attempt})`,
            )
          : Effect.void,
      ),
    ),
  );

const clientLayer = (urlKey: string) =>
  Layer.unwrapEffect(
    Config.redacted(urlKey).pipe(Effect.andThen((url) => PgClient.layer({ url }))),
  ).pipe(withDatabaseRetry);

const databaseLayer = <Self>(tag: Context.Tag<Self, Database>) =>
  Layer.effect(
    tag,
    Effect.map(SqlClient.SqlClient, (client) => new Database(client)),
  );

/** The API login, which `withAuthContext` switches to the visitor role. */
export class PgAuthDB extends Context.Tag("PgAuthDB")<PgAuthDB, Database>() {
  static Live = databaseLayer(this).pipe(Layer.provide(clientLayer("AUTH_DATABASE_URL")));
}

/** The migration login, which owns the schema and bypasses row-level security. */
export class PgRootDB extends Context.Tag("PgRootDB")<PgRootDB, Database>() {
  // Also exposes its PgClient, so scoped services such as RealtimeService share this pool.
  static Live = databaseLayer(this).pipe(Layer.provideMerge(clientLayer("DATABASE_URL")));
}

export const withAuthContext = Effect.fnUntraced(function* <A, E, R>(
  sessionId: string,
  cb: (db: Database) => Effect.Effect<A, E, R>,
) {
  const db = yield* PgAuthDB;
  const databaseVisitor = yield* Config.string("DATABASE_VISITOR");
  return yield* db.withTransaction(
    db
      .execute(
        db.selectNoFrom((eb) => [
          eb
            .fn<void>("set_config", [sql.lit("role"), eb.val(databaseVisitor), eb.lit(true)])
            .as("_1"),
          eb
            .fn<void>("set_config", [sql.lit("my.session_id"), eb.val(sessionId), eb.lit(true)])
            .as("_2"),
        ]),
      )
      .pipe(Effect.andThen(cb(db))),
  );
});
