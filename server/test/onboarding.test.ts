import { it, expect, describe, afterAll } from "vitest";
import { sqlSession } from "./sqlSession.js";

/**
 * The onboarding functions: app_public.finish_onboarding, app_public.set_initial_password and
 * app_public.add_my_child. The page flow is covered in e2e/onboarding.spec.ts.
 */

const db = sqlSession();

afterAll(db.end, 30_000);

/** A new account at first login, as an invitation or a sign-up leaves it. */
async function newAccount(role: "student" | "parent", password: string | null = null) {
  const userId = await db.createUser(role);
  await db.owner.query(`update app_public.users set onboarded_at = null where id = $1`, [userId]);
  if (password === null) {
    await db.owner.query(
      `update app_private.user_secrets set password_hash = null where user_id = $1`,
      [userId],
    );
  }
  return { userId, session: await db.sessionFor(userId) };
}

const login = (username: string, password: string) =>
  db.owner
    .query(`select (app_private.login($1, $2)).id`, [username, password])
    .then((r) => r.rows[0].id as string | null);

describe("onboarding", () => {
  it("finish_onboarding marks only the caller, once", async () => {
    const me = await newAccount("student");
    const other = await newAccount("student");
    await db.asVisitor(me.session, `select app_public.finish_onboarding()`);
    const first = await db.owner.query(
      `select id, onboarded_at from app_public.users where id = any($1)`,
      [[me.userId, other.userId]],
    );
    const at = (id: string) => first.rows.find((row) => row.id === id)?.onboarded_at;
    expect(at(me.userId)).toBeInstanceOf(Date);
    expect(at(other.userId)).toBeNull();

    await db.asVisitor(me.session, `select app_public.finish_onboarding()`);
    const again = await db.owner.query(`select onboarded_at from app_public.users where id = $1`, [
      me.userId,
    ]);
    expect(again.rows[0].onboarded_at).toEqual(at(me.userId));
  });

  it("set_initial_password sets a first password and never replaces one", async () => {
    const me = await newAccount("student");
    const [{ username }] = await db.asVisitor<{ username: string }>(
      me.session,
      `select username from app_public.users where id = $1`,
      [me.userId],
    );
    const [first] = await db.asVisitor<{ set: boolean }>(
      me.session,
      `select app_public.set_initial_password('first-pass-1') as set`,
    );
    expect(first.set).toBe(true);
    expect(await login(username, "first-pass-1")).toBeTruthy();

    const [second] = await db.asVisitor<{ set: boolean }>(
      me.session,
      `select app_public.set_initial_password('second-pass-2') as set`,
    );
    expect(second.set).toBe(false);
    expect(await login(username, "first-pass-1")).toBeTruthy();
  });

  it("add_my_child makes a family for a parent with none, with the parent paying", async () => {
    const parent = await newAccount("parent");
    const [child] = await db.asVisitor<{ id: string; role: string }>(
      parent.session,
      `select id, role from app_public.add_my_child('Kid One', $1::jsonb)`,
      [
        JSON.stringify([
          { instrument: "other", experience: "1_to_3_years", other_instrument: "Ukulele" },
        ]),
      ],
    );
    expect(child.role).toBe("student");

    const members = await db.owner.query(
      `select m.user_id, m.is_owner, m.is_billing_contact, f.name
         from app_public.family_memberships m join app_public.families f on f.id = m.family_id
        where m.family_id = (select family_id from app_public.family_memberships where user_id = $1)`,
      [child.id],
    );
    expect(members.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: parent.userId,
          is_owner: true,
          is_billing_contact: true,
        }),
        expect.objectContaining({ user_id: child.id, is_owner: false, is_billing_contact: false }),
      ]),
    );
    expect(members.rows[0].name).toMatch(/ family$/);

    const instruments = await db.owner.query(
      `select instrument, experience, other_instrument from app_public.student_instruments where user_id = $1`,
      [child.id],
    );
    expect(instruments.rows).toEqual([
      { instrument: "other", experience: "1_to_3_years", other_instrument: "Ukulele" },
    ]);

    // The second child joins the same family.
    const [second] = await db.asVisitor<{ id: string }>(
      parent.session,
      `select id from app_public.add_my_child('Kid Two')`,
    );
    const families = await db.owner.query(
      `select count(distinct family_id)::int as n from app_public.family_memberships where user_id = any($1)`,
      [[child.id, second.id]],
    );
    expect(families.rows[0].n).toBe(1);
  });

  it("add_my_child refuses a student with no family, and saves nothing for a bad instrument", async () => {
    const student = await newAccount("student");
    await expect(
      db.asVisitor(student.session, `select app_public.add_my_child('Sibling')`),
    ).rejects.toMatchObject({ code: "DNIED" });

    const parent = await newAccount("parent");
    await expect(
      db.asVisitor(parent.session, `select app_public.add_my_child('Kid', $1::jsonb)`, [
        JSON.stringify([{ instrument: "kazoo", experience: "none" }]),
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    const memberships = await db.owner.query(
      `select 1 from app_public.family_memberships where user_id = $1`,
      [parent.userId],
    );
    expect(memberships.rowCount).toBe(0);
  });
});
