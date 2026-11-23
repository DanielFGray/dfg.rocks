import { it, expect, describe, beforeAll, afterAll } from "vitest";
import { sqlSession, unique } from "./sqlSession.js";

/**
 * Row access on app_public.student_profiles and app_public.student_instruments: the student
 * and staff read and write, family members read, and anyone else sees nothing.
 */

const db = sqlSession();

const saveProfile = (sessionId: string, userId: string, background: string) =>
  db.asVisitor(
    sessionId,
    `insert into app_public.student_profiles (user_id, background) values ($1, $2)
       on conflict (user_id) do update set background = excluded.background
       returning background`,
    [userId, background],
  );

const saveInstrument = (
  sessionId: string,
  userId: string,
  instrument: string,
  experience: string,
) =>
  db.asVisitor(
    sessionId,
    `insert into app_public.student_instruments (user_id, instrument, experience) values ($1, $2, $3)
       on conflict (user_id, instrument) do update set experience = excluded.experience
       returning instrument, experience`,
    [userId, instrument, experience],
  );

const readProfile = (sessionId: string, userId: string) =>
  db.asVisitor(
    sessionId,
    `select p.background, array(
         select i.instrument from app_public.student_instruments i
          where i.user_id = p.user_id order by i.instrument
       ) as instruments
       from app_public.student_profiles p where p.user_id = $1`,
    [userId],
  );

describe("student profiles", () => {
  let studentId: string;
  let studentSession: string;
  let parentSession: string;
  let strangerSession: string;
  let teacherSession: string;

  beforeAll(async () => {
    studentId = await db.createUser("student");
    studentSession = await db.sessionFor(studentId);
    const parentId = await db.createUser("parent");
    parentSession = await db.sessionFor(parentId);
    strangerSession = await db.sessionFor(await db.createUser("student", "stranger"));
    teacherSession = await db.sessionFor(await db.createUser("teacher"));

    const family = await db.owner.query<{ id: string }>(
      `insert into app_public.families (slug, name) values ($1, 'Profile Family') returning id`,
      [unique("sp-family").replace(/_/g, "-")],
    );
    await db.owner.query(
      `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
       values ($1, $2, true, true), ($1, $3, false, false)`,
      [family.rows[0].id, parentId, studentId],
    );
  }, 120_000);

  afterAll(db.end, 30_000);

  it("the student writes their own profile and instruments", async () => {
    await saveProfile(studentSession, studentId, "Played in school band");
    await saveInstrument(studentSession, studentId, "drums", "1_to_3_years");
    await saveInstrument(studentSession, studentId, "piano", "none");
    expect(await readProfile(studentSession, studentId)).toEqual([
      { background: "Played in school band", instruments: ["drums", "piano"] },
    ]);
  });

  it("a family member reads the profile and cannot change it", async () => {
    expect(await readProfile(parentSession, studentId)).toEqual([
      { background: "Played in school band", instruments: ["drums", "piano"] },
    ]);
    await expect(saveProfile(parentSession, studentId, "Changed")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("another student sees nothing", async () => {
    expect(await readProfile(strangerSession, studentId)).toEqual([]);
    await expect(
      saveInstrument(strangerSession, studentId, "guitar", "none"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("staff edit the profile", async () => {
    await saveProfile(teacherSession, studentId, "Back after five years off");
    await saveInstrument(teacherSession, studentId, "drums", "over_10_years");
    const rows = await db.owner.query(
      `select experience from app_public.student_instruments where user_id = $1 and instrument = 'drums'`,
      [studentId],
    );
    expect(rows.rows[0].experience).toBe("over_10_years");
    expect((await readProfile(studentSession, studentId))[0].background).toBe(
      "Back after five years off",
    );
  });

  it("refuses an instrument or experience outside the lists", async () => {
    await expect(saveInstrument(studentSession, studentId, "kazoo", "none")).rejects.toMatchObject({
      code: "23514",
    });
    await expect(
      saveInstrument(studentSession, studentId, "guitar", "forever"),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
