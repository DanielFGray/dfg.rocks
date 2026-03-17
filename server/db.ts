import { Context, Effect, Layer, Config, Schedule } from "effect";
import pg from "pg";
import { PgClient } from "@effect/sql-pg";
import * as PgKysely from "@effect/sql-kysely/Pg";
import type { DB } from "../generated/db.js";
import { env } from "./assertEnv.js";
import { sql } from "kysely";

pg.types.setTypeParser(20, (val: string) => Number(val));

export type KyselyDB = PgKysely.EffectKysely<DB>;

const withRetry = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  Layer.retry(
    layer,
    Schedule.exponential("100 millis").pipe(
      Schedule.intersect(Schedule.recurs(10)),
      Schedule.jittered,
    ),
  );

export class PgRootDB extends Context.Tag("PgRootDB")<PgRootDB, KyselyDB>() {
  static Conn = Layer.unwrapEffect(
    Config.redacted("DATABASE_URL").pipe(
      Effect.andThen((url) => PgClient.layer({ url })),
    ),
  ).pipe(withRetry);
  static Kysely = Layer.effect(this, PgKysely.make<DB>());
  static Live = this.Kysely.pipe(Layer.provide(this.Conn));
}

export class PgAuthDB extends Context.Tag("PgAuthDB")<PgAuthDB, KyselyDB>() {
  static Conn = Layer.unwrapEffect(
    Config.redacted("AUTH_DATABASE_URL").pipe(
      Effect.andThen((url) => PgClient.layer({ url })),
    ),
  ).pipe(withRetry);
  static Kysely = Layer.effect(this, PgKysely.make<DB>());
  static Live = this.Kysely.pipe(Layer.provide(this.Conn));
}

export const withAuthContext = <A, E>(
  db: KyselyDB,
  userId: string | undefined,
  userRole: string | undefined,
  effect: Effect.Effect<A, E>,
) =>
  db.withTransaction(
    Effect.gen(function* () {
      const visitor = env.DATABASE_VISITOR;
      yield* db.selectNoFrom([
        sql<string>`set_config('role', ${visitor}, true)`.as("_role"),
        sql<string>`set_config('my.user_id', ${userId ?? ""}, true)`.as("_user_id"),
        sql<string>`set_config('my.user_role', ${userRole ?? ""}, true)`.as("_user_role"),
      ]);
      return yield* effect;
    }),
  );
