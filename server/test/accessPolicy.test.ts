import { it, expect, describe, beforeAll, afterAll } from "vitest";
import pg from "pg";

/**
 * What a signed-in account can reach through the visitor role. Anyone can get
 * an account by signing in with Google or Apple, so an account with no family,
 * no rate and no enrollment (a "stranger") must see and touch only itself and
 * staff.
 */

let ownerPool: pg.Pool;
let visitorPool: pg.Pool;

const ids: Record<"admin" | "stranger" | "parent" | "kid", string> = {
  admin: "",
  stranger: "",
  parent: "",
  kid: "",
};
const sessions: Record<"stranger" | "parent" | "kid", string> = {
  stranger: "",
  parent: "",
  kid: "",
};
let familyId: string;

describe("access policy for signed-in accounts", () => {
  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: forceIpv4(requiredEnv("DATABASE_URL")) });
    visitorPool = new pg.Pool({ connectionString: forceIpv4(requiredEnv("AUTH_DATABASE_URL")) });

    ids.admin = await createUser("acc_admin", "admin");
    ids.stranger = await createUser("acc_stranger", "student");
    ids.parent = await createUser("acc_parent", "parent");
    ids.kid = await createUser("acc_kid", "student");

    const family = await owner(
      `insert into app_public.families (slug, name) values ('acc-family', 'Acc Family') returning id`,
    );
    familyId = family.rows[0].id;
    await owner(
      `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
       values ($1, $2, true, true), ($1, $3, false, false)`,
      [familyId, ids.parent, ids.kid],
    );

    for (const name of ["stranger", "parent", "kid"] as const) {
      const r = await owner(
        `insert into app_private.sessions (user_id) values ($1) returning id`,
        [ids[name]],
      );
      sessions[name] = r.rows[0].id;
    }
  }, 120_000);

  afterAll(async () => {
    await ownerPool?.end();
    await visitorPool?.end();
  }, 30_000);

  it("a stranger sees only itself and staff", async () => {
    const rows = await asVisitor(sessions.stranger, (c) =>
      c.query<{ id: string; role: string | null }>(`select id, role from app_public.users`),
    );
    const visible = rows.rows.map((r) => r.id);
    expect(visible).toContain(ids.stranger);
    expect(visible).toContain(ids.admin);
    expect(visible).not.toContain(ids.kid);
    expect(visible).not.toContain(ids.parent);
    for (const row of rows.rows) {
      expect(row.id === ids.stranger || row.role === "admin" || row.role === "teacher").toBe(true);
    }
  });

  it("a parent sees the members of their family", async () => {
    const rows = await asVisitor(sessions.parent, (c) =>
      c.query<{ id: string }>(`select id from app_public.users where id = any($1)`, [
        [ids.kid, ids.stranger],
      ]),
    );
    expect(rows.rows.map((r) => r.id)).toEqual([ids.kid]);
  });

  it("a non-staff user can message staff but not another user", async () => {
    await asVisitor(sessions.stranger, (c) =>
      c.query(
        `insert into app_public.messages (sender_id, recipient_id, body) values ($1, $2, 'hello')`,
        [ids.stranger, ids.admin],
      ),
    );
    await expect(
      asVisitor(sessions.stranger, (c) =>
        c.query(
          `insert into app_public.messages (sender_id, recipient_id, body) values ($1, $2, 'hi')`,
          [ids.stranger, ids.kid],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asVisitor(sessions.kid, (c) =>
        c.query(
          `insert into app_public.messages (sender_id, recipient_id, body) values ($1, $2, 'hi')`,
          [ids.kid, ids.parent],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("a student can book only at a location priced for them", async () => {
    const book = (locationType: string) =>
      asVisitor(sessions.stranger, (c) =>
        c.query(
          `insert into app_public.lessons (student_id, scheduled_at, duration_minutes, location_type, status)
           values ($1, now() + interval '30 days', 30, $2, 'scheduled')`,
          [ids.stranger, locationType],
        ),
      );
    await expect(book("online")).rejects.toMatchObject({ code: "42501" });

    await owner(
      `insert into app_public.student_rates (student_id, rate_cents, lesson_duration_minutes, location_type)
       values ($1, 4000, 30, 'online')`,
      [ids.stranger],
    );
    await book("online");
    await expect(book("studio")).rejects.toMatchObject({ code: "42501" });
  });

  it("a non-staff user cannot create a family, a child, or an invitation", async () => {
    await expect(
      asVisitor(sessions.stranger, (c) =>
        c.query(`select app_public.create_family('acc-stranger-fam', 'Stranger Family')`),
      ),
    ).rejects.toMatchObject({ code: "DNIED" });
    await expect(
      asVisitor(sessions.stranger, (c) =>
        c.query(`select app_public.create_child($1, 'Some Child')`, [familyId]),
      ),
    ).rejects.toMatchObject({ code: "DNIED" });
    await expect(
      asVisitor(sessions.stranger, (c) =>
        c.query(`select app_public.invite_to_family($1, 'acc_kid')`, [familyId]),
      ),
    ).rejects.toMatchObject({ code: "DNIED" });
  });

  // The visitor holds TEMP, and Postgres searches pg_temp first for tables unless
  // search_path names it last, so a temporary table could shadow one a
  // SECURITY DEFINER body names.
  it("every SECURITY DEFINER function ends its search_path with pg_temp", async () => {
    const unsafe = await owner(
      `select p.oid::regprocedure::text as fn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef
          and n.nspname in ('app_public', 'app_hidden', 'app_private')
          and not exists (
            select 1 from unnest(coalesce(p.proconfig, '{}')) setting
             where setting ~ '^search_path=.*pg_temp$'
          )`,
    );
    expect(unsafe.rows.map((r) => r.fn)).toEqual([]);
  });
});
async function createUser(username: string, role: string): Promise<string> {
  const r = await owner(
    `select id from app_private.really_create_user($1::citext, $1, null, true, $2::citext, $3)`,
    [username, `${username.replace(/_/g, "-")}@test.com`, `${username}123`],
  );
  await owner(`update app_public.users set role = $1 where id = $2`, [role, r.rows[0].id]);
  return r.rows[0].id;
}

function owner(text: string, params?: unknown[]) {
  return ownerPool.query(text, params);
}

/** Runs `fn` as the visitor role for one session, then rolls back. */
async function asVisitor<T>(sessionId: string, fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await visitorPool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role "${requiredEnv("DATABASE_VISITOR")}"`);
    await client.query("select set_config('my.session_id', $1, true)", [sessionId]);
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

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
