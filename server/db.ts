import { PgClient, PgTypes } from "@effect/sql-pg";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { Effect, Context, Config, Layer, Result } from "effect";
import { waitFor } from "./dependencies.js";
import {
  type CompiledQuery,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from "kysely";
import type { DB } from "../generated/db.js";

/** Anything Kysely can compile: query builders and `sql` template expressions. */
export interface Compilable<O> {
  compile(): CompiledQuery<O>;
}

/**
 * Kysely builds and compiles queries; the Effect SQL client runs them. Running
 * through the client keeps queries inside Effect transactions, which
 * visitor queries need for their per-transaction `set_config`.
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

/**
 * Result codecs for the shapes the response schemas expect. The driver decodes
 * `int8` as a bigint and `time` as a bigint of microseconds by default; counts
 * and ids fit in a number, and times are compared and shown as `HH:MM:SS`.
 * The driver decodes `date` as its `YYYY-MM-DD` text, so a calendar day never
 * moves with the server's time zone; `dateParser` in `.kysely-codegenrc.json`
 * types those columns as `string` to match.
 * Parameters are unaffected: untyped parameters are sent as text.
 */
export const pgTypes = PgTypes.makeRegistry();

const int8Bytes = (value: bigint) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value);
  return bytes;
};
const readInt8 = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(0);

pgTypes.register<number>(PgTypes.OID.int8, {
  encode: (value) => Result.succeed(int8Bytes(BigInt(value))),
  decode: (bytes) => Result.succeed(Number(readInt8(bytes))),
});

const MICROS_PER_SECOND = 1_000_000n;

pgTypes.register<string>(PgTypes.OID.time, {
  encode: (value) => {
    const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/.exec(value);
    if (!match) return Result.fail(new PgTypes.CodecError({ message: `Invalid time: ${value}` }));
    const [, hours, minutes, seconds = "0", fraction = ""] = match;
    const micros =
      (BigInt(hours!) * 3600n + BigInt(minutes!) * 60n + BigInt(seconds)) * MICROS_PER_SECOND +
      BigInt(fraction.padEnd(6, "0") || "0");
    return Result.succeed(int8Bytes(micros));
  },
  decode: (bytes) => {
    const micros = readInt8(bytes);
    const totalSeconds = Number(micros / MICROS_PER_SECOND);
    const fraction = micros % MICROS_PER_SECOND;
    const pad = (n: number) => String(n).padStart(2, "0");
    const clock = `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}`;
    // Matches PostgreSQL's text output, which drops trailing zeros from the fraction.
    return Result.succeed(
      fraction === 0n ? clock : `${clock}.${String(fraction).padStart(6, "0").replace(/0+$/, "")}`,
    );
  },
});

const clientLayer = (urlKey: string) =>
  PgClient.layerFrom(
    Config.Redacted(urlKey).pipe(
      Effect.flatMap((url) => PgClient.make({ url, types: pgTypes })),
      waitFor(`postgres (${urlKey})`),
    ),
  );

const databaseLayer = <Self>(tag: Context.Key<Self, Database>) =>
  Layer.effect(
    tag,
    Effect.map(SqlClient.SqlClient, (client) => new Database(client)),
  );

/** The API login used for transactions under the visitor role. */
export class PgAuthDB extends Context.Service<PgAuthDB, Database>()("PgAuthDB") {
  static Live = databaseLayer(this).pipe(Layer.provide(clientLayer("AUTH_DATABASE_URL")));
}

/** The migration login, which owns the schema and bypasses row-level security. */
export class PgRootDB extends Context.Service<PgRootDB, Database>()("PgRootDB") {
  // Also exposes its PgClient, so scoped services such as RealtimeService share this pool.
  static Live = databaseLayer(this).pipe(Layer.provideMerge(clientLayer("DATABASE_URL")));
}

/**
 * Queues a graphile-worker job inside the current transaction. Only the job id
 * is selected: the driver decodes results in binary and has no codec for the
 * composite job row that `add_job` returns.
 */
export const addJob = (db: Database, task: string, payload: unknown) =>
  db.execute(
    db.selectNoFrom(
      sql<string>`(graphile_worker.add_job(${task}, ${JSON.stringify(payload)}::json)).id`.as(
        "job_id",
      ),
    ),
  );
