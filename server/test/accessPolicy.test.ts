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

const sessionOf = new Map<string, string>();
const FULL = { course: true, module: true, moduleMaterial: true, material: true };
const NONE = { course: false, module: false, moduleMaterial: false, material: false };

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
      const r = await owner(`insert into app_private.sessions (user_id) values ($1) returning id`, [
        ids[name],
      ]);
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

  // Staff read every family's members, so a teacher can see any person's families. A student reads
  // only the memberships of the families it belongs to, and a stranger reads none.
  it("a teacher reads every family's memberships; a student reads only its own family's", async () => {
    const teacherId = await createUser("acc_teacher", "teacher");
    const teacherSession = (
      await owner(`insert into app_private.sessions (user_id) values ($1) returning id`, [
        teacherId,
      ])
    ).rows[0].id;
    const otherParent = await createUser("acc_other_parent", "parent");
    const otherKid = await createUser("acc_other_kid", "student");
    const otherFamily = await owner(
      `insert into app_public.families (slug, name) values ('acc-other-family', 'Other Family') returning id`,
    );
    const otherFamilyId = otherFamily.rows[0].id;
    await owner(
      `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
       values ($1, $2, true, true), ($1, $3, false, false)`,
      [otherFamilyId, otherParent, otherKid],
    );

    const membershipsSeen = (sessionId: string) =>
      asVisitor(sessionId, async (c) => {
        const r = await c.query<{ family_id: string; user_id: string }>(
          `select family_id, user_id from app_public.family_memberships`,
        );
        return r.rows;
      });

    const teacherRows = await membershipsSeen(teacherSession);
    expect(
      teacherRows
        .filter((r) => r.family_id === otherFamilyId)
        .map((r) => r.user_id)
        .sort(),
    ).toEqual([otherParent, otherKid].sort());
    expect(teacherRows.some((r) => r.family_id === familyId)).toBe(true);

    const kidRows = await membershipsSeen(sessions.kid);
    expect(kidRows.length).toBeGreaterThan(0);
    expect(kidRows.every((r) => r.family_id === familyId)).toBe(true);

    expect(await membershipsSeen(sessions.stranger)).toEqual([]);
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

  // A SECURITY DEFINER function runs past RLS, so the visitor may execute only the ones listed
  // here, each meant to be called by a signed-in account. Default privileges grant EXECUTE on every
  // new app_public function, and again whenever a migration re-creates one: a new function fails
  // this test until it is either listed or revoked from the visitor.
  it("the visitor executes only the SECURITY DEFINER functions meant for it", async () => {
    const executable = await owner(
      `select p.oid::regprocedure::text as fn
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef
          and n.nspname in ('app_public', 'app_hidden', 'app_private')
          and has_function_privilege($1, p.oid, 'execute')
        order by 1`,
      [requiredEnv("DATABASE_VISITOR")],
    );
    expect(executable.rows.map((r) => r.fn)).toEqual([
      "app_public.accept_invitation_to_family(uuid,text)",
      "app_public.can_book_for_family_student(uuid)",
      "app_public.can_read_course(uuid,uuid)",
      "app_public.change_password(text,text)",
      "app_public.confirm_account_deletion(text)",
      "app_public.create_child(uuid,text)",
      "app_public.create_family(citext,text)",
      "app_public.create_single_booking_obligation(uuid)",
      "app_public.current_effective_user_id()",
      "app_public.current_user_family_member_ids()",
      "app_public.current_user_id()",
      "app_public.current_user_invited_family_ids()",
      "app_public.current_user_member_family_ids()",
      "app_public.current_user_role()",
      "app_public.current_user_visible_payer_ids()",
      "app_public.delete_family(uuid)",
      "app_public.enqueue_prepaid_lesson_generation(uuid)",
      "app_public.family_for_invitation(uuid,text)",
      "app_public.forgot_password(citext)",
      "app_public.invite_to_family(uuid,citext,citext,text)",
      "app_public.is_acting_for_family_student(uuid)",
      "app_public.logout()",
      "app_public.make_email_primary(uuid)",
      "app_public.next_bill_number()",
      "app_public.next_payment_number()",
      "app_public.remove_from_family(uuid,uuid)",
      "app_public.request_account_deletion()",
      "app_public.resend_email_verification_code(uuid)",
      "app_public.set_user_role(uuid,app_public.user_role)",
      "app_public.settle_single_booking_cancellation(uuid,integer)",
      "app_public.tg__graphql_subscription()",
      "app_public.tg_user_emails__forbid_if_verified()",
      "app_public.tg_user_emails__prevent_delete_last_email()",
      "app_public.tg_user_emails__verify_account_on_verified()",
      "app_public.transfer_family_billing_contact(uuid,uuid)",
      "app_public.transfer_family_ownership(uuid,uuid)",
      "app_public.users_has_password(app_public.users)",
      "app_public.verify_email(uuid,text)",
    ]);
  });

  // Each reader below has exactly one way in (or none), so a passing case proves that route.
  // The course-content material is not global and no student_materials row names it, so no
  // other policy branch can admit it.
  describe("course access", () => {
    const today = `(now() at time zone 'America/Chicago')::date`;
    let courseId: string;
    let moduleId: string;
    let materialId: string;
    const reader: Record<string, string> = {};

    beforeAll(async () => {
      const course = await owner(
        `insert into app_public.courses (title) values ('Access Course') returning id`,
      );
      courseId = course.rows[0].id;
      const module = await owner(
        `insert into app_public.modules (course_id, title) values ($1, 'Access Module') returning id`,
        [courseId],
      );
      moduleId = module.rows[0].id;
      const material = await owner(
        `insert into app_public.materials (title, original_filename, storage_key)
         values ('Access Sheet', 'sheet.pdf', 'acc/sheet.pdf') returning id`,
      );
      materialId = material.rows[0].id;
      await owner(
        `insert into app_public.module_materials (module_id, material_id) values ($1, $2)`,
        [moduleId, materialId],
      );

      // The existing kid is enrolled, so the kid and the parent reach the course through
      // enrollment.
      await owner(`insert into app_public.enrollments (student_id, course_id) values ($1, $2)`, [
        ids.kid,
        courseId,
      ]);
      reader.kid = ids.kid;
      reader.parent = ids.parent;
      reader.stranger = ids.stranger;

      reader.scheduled = await createUser("acc_scheduled", "student");
      await weeklySchedule(reader.scheduled, `${today} - 30`, null, true);

      reader.endedYesterday = await createUser("acc_ended", "student");
      await weeklySchedule(reader.endedYesterday, `${today} - 60`, `${today} - 1`, true);

      reader.inactive = await createUser("acc_inactive", "student");
      await weeklySchedule(reader.inactive, `${today} - 30`, null, false);

      reader.selfPastDue = await createUser("acc_selfpay", "student");
      await subscription(
        reader.selfPastDue,
        reader.selfPastDue,
        "past_due",
        "now() + interval '5 days'",
      );

      reader.canceled = await createUser("acc_canceled", "student");
      await subscription(reader.canceled, reader.canceled, "canceled", "now() + interval '5 days'");

      reader.periodEnded = await createUser("acc_expired", "student");
      await subscription(
        reader.periodEnded,
        reader.periodEnded,
        "active",
        "now() - interval '1 day'",
      );

      const billingParent = await createUser("acc_billing", "parent");
      const billingKid = await createUser("acc_billing_kid", "student");
      const billingFamily = await owner(
        `insert into app_public.families (slug, name) values ('acc-billing-family', 'Billing Family') returning id`,
      );
      await owner(
        `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
         values ($1, $2, true, true), ($1, $3, false, false)`,
        [billingFamily.rows[0].id, billingParent, billingKid],
      );
      await subscription(billingParent, billingParent, "active", "now() + interval '30 days'");
      reader.familySubscriber = billingKid;
      reader.familyBillingParent = billingParent;

      // Two families, each a parent, a learner and a sibling. The first learner is enrolled; the
      // second has a weekly schedule. The siblings hold nothing, so only the parent-learner route
      // could reach the course for them.
      const family = async (slug: string) => {
        const parent = await createUser(`${slug}_parent`, "parent");
        const learner = await createUser(`${slug}_learner`, "student");
        const sibling = await createUser(`${slug}_sibling`, "student");
        const f = await owner(
          `insert into app_public.families (slug, name) values ($1::citext, $2) returning id`,
          [slug, slug],
        );
        await owner(
          `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
           values ($1, $2, true, true), ($1, $3, false, false), ($1, $4, false, false)`,
          [f.rows[0].id, parent, learner, sibling],
        );
        return { parent, learner, sibling };
      };
      const enrolledFamily = await family("acc_enrolled_fam");
      await owner(`insert into app_public.enrollments (student_id, course_id) values ($1, $2)`, [
        enrolledFamily.learner,
        courseId,
      ]);
      reader.parentOfEnrolled = enrolledFamily.parent;
      reader.enrolledLearner = enrolledFamily.learner;
      reader.siblingOfEnrolled = enrolledFamily.sibling;

      const scheduledFamily = await family("acc_scheduled_fam");
      await weeklySchedule(scheduledFamily.learner, `${today} - 30`, null, true);
      reader.parentOfScheduled = scheduledFamily.parent;
      reader.scheduledLearner = scheduledFamily.learner;
      reader.siblingOfScheduled = scheduledFamily.sibling;

      reader.admin = ids.admin;

      for (const userId of Object.values(reader)) {
        const r = await owner(
          `insert into app_private.sessions (user_id) values ($1) returning id`,
          [userId],
        );
        sessionOf.set(userId, r.rows[0].id);
      }
    }, 120_000);

    it("an enrolled student and a parent of an enrolled student reach the course", async () => {
      expect(await reachOf(reader.kid)).toEqual(FULL);
      expect(await reachOf(reader.parent)).toEqual(FULL);
    });

    it("a student with an active weekly schedule reaches the course without enrollment", async () => {
      expect(await reachOf(reader.scheduled)).toEqual(FULL);
    });

    it("a student whose family billing contact has a live subscription reaches the course", async () => {
      expect(await reachOf(reader.familySubscriber)).toEqual(FULL);
      expect(await reachOf(reader.familyBillingParent)).toEqual(FULL);
    });

    it("a self-paying student with a past_due subscription keeps access", async () => {
      expect(await reachOf(reader.selfPastDue)).toEqual(FULL);
    });

    it("a stranger reaches no course content", async () => {
      expect(await reachOf(reader.stranger)).toEqual(NONE);
    });

    it("a canceled subscription or one whose period has passed grants nothing", async () => {
      expect(await reachOf(reader.canceled)).toEqual(NONE);
      expect(await reachOf(reader.periodEnded)).toEqual(NONE);
    });

    it("a weekly schedule that ended yesterday or is inactive grants nothing", async () => {
      expect(await reachOf(reader.endedYesterday)).toEqual(NONE);
      expect(await reachOf(reader.inactive)).toEqual(NONE);
    });

    it("a reader's access is reported only to staff and to members of the reader's family", async () => {
      const probe = (sessionId: string, readerId: string) =>
        asVisitor(sessionId, async (c) => {
          const r = await c.query<{ ok: boolean }>(
            `select app_public.can_read_course($1, $2) as ok`,
            [courseId, readerId],
          );
          return r.rows[0].ok;
        });
      // The kid is enrolled, so only the access check decides what each caller learns.
      expect(await probe(sessions.parent, ids.kid)).toBe(true);
      expect(await probe(sessions.stranger, ids.kid)).toBe(false);
      expect(await probe(sessions.stranger, reader.scheduled)).toBe(false);
      expect(await probe(sessions.kid, reader.kid)).toBe(true);
      expect(await probe(sessions.stranger, reader.stranger)).toBe(false);
    });

    it("a sibling of an enrolled learner reaches nothing; the parent and the learner reach the course", async () => {
      expect(await reachOf(reader.siblingOfEnrolled)).toEqual(NONE);
      expect(await reachOf(reader.parentOfEnrolled)).toEqual(FULL);
      expect(await reachOf(reader.enrolledLearner)).toEqual(FULL);
    });

    it("a sibling of a scheduled learner reaches nothing; the parent and the learner reach the course", async () => {
      expect(await reachOf(reader.siblingOfScheduled)).toEqual(NONE);
      expect(await reachOf(reader.parentOfScheduled)).toEqual(FULL);
      expect(await reachOf(reader.scheduledLearner)).toEqual(FULL);
    });

    it("a staff caller gets each reader's real answer", async () => {
      const probe = (readerId: string) =>
        asVisitor(sessionOf.get(reader.admin)!, async (c) => {
          const r = await c.query<{ ok: boolean }>(
            `select app_public.can_read_course($1, $2) as ok`,
            [courseId, readerId],
          );
          return r.rows[0].ok;
        });
      expect(await probe(reader.enrolledLearner)).toBe(true);
      expect(await probe(reader.scheduledLearner)).toBe(true);
      expect(await probe(reader.siblingOfEnrolled)).toBe(false);
      expect(await probe(reader.siblingOfScheduled)).toBe(false);
    });

    it("a schedule in a time zone PostgreSQL does not know is refused on insert and on update", async () => {
      const student = await createUser("acc_badtz", "student");
      const rate = await owner(
        `insert into app_public.student_rates (student_id, rate_cents, lesson_duration_minutes, location_type)
         values ($1, 4000, 30, 'online') returning id`,
        [student],
      );
      await expect(
        owner(
          `insert into app_public.recurring_schedules
             (student_rate_id, day_of_week, local_start_time, timezone, starts_on)
           values ($1, 2, '16:00', 'Mars/Olympus', ${today} - 30)`,
          [rate.rows[0].id],
        ),
      ).rejects.toMatchObject({ code: "DNIED", message: expect.stringContaining("Mars/Olympus") });

      await expect(
        owner(
          `update app_public.recurring_schedules set timezone = 'Mars/Olympus'
           where student_rate_id in (select id from app_public.student_rates where student_id = $1)`,
          [reader.scheduled],
        ),
      ).rejects.toMatchObject({ code: "DNIED" });
    });

    async function reachOf(userId: string) {
      return asVisitor(sessionOf.get(userId)!, async (c) => {
        const count = async (text: string, params: unknown[]) =>
          (await c.query(text, params)).rowCount === 1;
        return {
          course: await count(`select id from app_public.courses where id = $1`, [courseId]),
          module: await count(`select id from app_public.modules where id = $1`, [moduleId]),
          moduleMaterial: await count(
            `select material_id from app_public.module_materials where module_id = $1 and material_id = $2`,
            [moduleId, materialId],
          ),
          material: await count(`select id from app_public.materials where id = $1`, [materialId]),
        };
      });
    }

    async function weeklySchedule(
      studentId: string,
      startsOn: string,
      endsOn: string | null,
      active: boolean,
    ) {
      const rate = await owner(
        `insert into app_public.student_rates (student_id, rate_cents, lesson_duration_minutes, location_type)
         values ($1, 4000, 30, 'online') returning id`,
        [studentId],
      );
      await owner(
        `insert into app_public.recurring_schedules
           (student_rate_id, day_of_week, local_start_time, starts_on, ends_on, active)
         values ($1, 2, '16:00', ${startsOn}, ${endsOn ?? "null"}, $2)`,
        [rate.rows[0].id, active],
      );
    }

    async function subscription(
      studentId: string,
      payerId: string,
      status: string,
      periodEnd: string,
    ) {
      await owner(
        `insert into app_public.subscriptions
           (payer_id, stripe_customer_id, stripe_subscription_id, status, price_id, current_period_end)
         values ($1, $2, $3, $4, 'price_test', ${periodEnd})`,
        [payerId, `cus_${studentId}`, `sub_${studentId}_${status}`, status],
      );
    }
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
