import type { EffectKysely } from "@effect/sql-kysely/Kysely";
import * as PgKysely from "@effect/sql-kysely/Pg";
import { PgClient } from "@effect/sql-pg";
import { Effect, Context, Config, Schedule, Layer, Duration } from "effect";
import { sql } from "kysely";
import { EventEmitter } from "node:events";
import pg from "pg";

EventEmitter.defaultMaxListeners = 20;
import type { DB } from "../generated/db.js";

pg.types.setTypeParser(20, (val: string) => Number(val));

export type AuthKyselyDB = EffectKysely<DB>;

export type KyselyDB = PgKysely.EffectKysely<DB>;

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

export class PgAuthDB extends Context.Tag("PgAuthDB")<PgAuthDB, KyselyDB>() {
  static Conn = Layer.unwrapEffect(
    Config.redacted("AUTH_DATABASE_URL").pipe(Effect.andThen((url) => PgClient.layer({ url }))),
  ).pipe(withDatabaseRetry);
  static Kysely = Layer.effect(this, PgKysely.make<DB>());
  static Live = this.Kysely.pipe(Layer.provide(this.Conn));
}

export class PgRootDB extends Context.Tag("PgRootDB")<PgRootDB, KyselyDB>() {
  static Conn = Layer.unwrapEffect(
    Config.redacted("DATABASE_URL").pipe(Effect.andThen((url) => PgClient.layer({ url }))),
  ).pipe(withDatabaseRetry);
  static Kysely = Layer.effect(this, PgKysely.make<DB>());
  static Live = this.Kysely.pipe(Layer.provide(this.Conn));
}

export const withAuthContext = Effect.fnUntraced(function* <A, E>(
  sessionId: string,
  cb: (db: AuthKyselyDB) => Effect.Effect<A, E, never>,
) {
  const db = yield* PgAuthDB;
  const databaseVisitor = yield* Config.string("DATABASE_VISITOR");
  return yield* db.withTransaction(
    db
      .selectNoFrom((eb) => [
        eb.fn<void>("set_config", [sql.lit("role"), eb.val(databaseVisitor), eb.lit(false)]).as("_1"),
        eb
          .fn<void>("set_config", [sql.lit("my.session_id"), eb.val(sessionId), eb.lit(true)])
          .as("_2"),
      ])
      .pipe(Effect.andThen(cb(db))),
  );
});
