import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { DB } from "../generated/db.js";
import { env } from "./assertEnv.js";

pg.types.setTypeParser(20, (val: string) => Number(val));

export type KyselyDB = Kysely<DB>;

const rootPool = new pg.Pool({ connectionString: env.DATABASE_URL });
const authPool = new pg.Pool({ connectionString: env.AUTH_DATABASE_URL });

export const rootDb = new Kysely<DB>({ dialect: new PostgresDialect({ pool: rootPool }) });
export const authDb = new Kysely<DB>({ dialect: new PostgresDialect({ pool: authPool }) });

export async function withAuthContext<T>(
  sessionId: string,
  fn: (db: Kysely<DB>) => Promise<T>,
): Promise<T> {
  return authDb.transaction().execute(async (trx) => {
    const visitor = env.DATABASE_VISITOR;
    await sql`select set_config('role', ${visitor}, true)`.execute(trx);
    await sql`select set_config('my.session_id', ${sessionId}, true)`.execute(trx);
    return fn(trx);
  });
}
