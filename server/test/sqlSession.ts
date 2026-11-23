import pg from "pg";

/**
 * Two pools for SQL-level tests: `owner` runs as the migration role and sets up rows that no
 * visitor could, and `asVisitor` runs one committed transaction as a session's user, with RLS,
 * the way `withAuthContext` does for a request.
 */
export function sqlSession() {
  const owner = new pg.Pool({ connectionString: forceIpv4(requiredEnv("DATABASE_URL")) });
  const visitor = new pg.Pool({ connectionString: forceIpv4(requiredEnv("AUTH_DATABASE_URL")) });

  /** Creates a verified account with a password, an address, and the role. */
  async function createUser(role: string, label = role): Promise<string> {
    const username = unique(`t_${label}`);
    const r = await owner.query<{ id: string }>(
      `select id from app_private.really_create_user($1::citext, $1, null, true, $2::citext, 'password123')`,
      [username, `${username.replace(/_/g, "-")}@test.com`],
    );
    await owner.query(`update app_public.users set role = $1 where id = $2`, [role, r.rows[0].id]);
    return r.rows[0].id;
  }

  async function sessionFor(userId: string): Promise<string> {
    const r = await owner.query<{ id: string }>(
      `insert into app_private.sessions (user_id) values ($1) returning id`,
      [userId],
    );
    return r.rows[0].id;
  }

  async function asVisitor<T = Record<string, unknown>>(
    sessionId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const client = await visitor.connect();
    try {
      await client.query("begin");
      await client.query(`set local role "${requiredEnv("DATABASE_VISITOR")}"`);
      await client.query("select set_config('my.session_id', $1, true)", [sessionId]);
      const result = await client.query(sql, params);
      await client.query("commit");
      return result.rows as T[];
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const end = () => Promise.all([owner.end(), visitor.end()]);

  return { owner, createUser, sessionFor, asVisitor, end };
}

export const unique = (label: string) => `${label}_${Math.random().toString(36).slice(2, 10)}`;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function forceIpv4(urlString: string): string {
  const url = new URL(urlString);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.toString();
}
