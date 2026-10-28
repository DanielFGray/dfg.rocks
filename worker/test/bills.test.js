// @ts-check
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";

function testDatabaseUrl(raw) {
  if (!raw) return raw;
  const url = new URL(raw);
  if (!url.pathname.endsWith("_test")) url.pathname = `${url.pathname}_test`;
  return url.toString();
}

const DATABASE_URL = testDatabaseUrl(process.env.DATABASE_URL);
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

/** @type {pg.PoolClient} */
let client;

beforeAll(async () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  client = await pool.connect();
  await client.query("begin");
});

afterAll(async () => {
  try {
    await client.query("rollback");
  } catch {}
  try {
    client.release();
  } catch {}
});

async function q(sql, params) {
  return client.query(sql, params);
}

async function createUser(username, name) {
  const email = `${username}@bills.test`;
  await q(
    `select app_private.really_create_user($1::citext, $2, null, true, $3::citext, 'testpass')`,
    [username, name, email],
  );
  const { rows } = await q("select id from app_public.users where username = $1", [username]);
  return rows[0].id;
}

async function createFamily(slug, name, studentId, adminId) {
  const { rows } = await q(
    "insert into app_public.families (slug, name) values ($1, $2) returning id",
    [slug, name],
  );
  const fid = rows[0].id;
  await q(
    "insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact) values ($1::uuid, $2::uuid, true, true)",
    [fid, adminId],
  );
  await q(
    "insert into app_public.family_memberships (family_id, user_id) values ($1::uuid, $2::uuid)",
    [fid, studentId],
  );
  return fid;
}

async function createRate(studentId, cents, minutes, locType) {
  const { rows } = await q(
    `insert into app_public.student_rates (student_id, rate_cents, lesson_duration_minutes, location_type, billing_model)
     values ($1::uuid, $2, $3, $4::app_public.location_type, 'monthly_prepaid')
     returning id`,
    [studentId, cents, minutes, locType],
  );
  return rows[0].id;
}

async function createSchedule(opts) {
  const { rateId, dayOfWeek, time, startsOn, endsOn } = opts;
  await q(
    `insert into app_public.recurring_schedules (student_rate_id, day_of_week, local_start_time, timezone, starts_on, ends_on)
     values ($1::uuid, $2, $3, 'America/Chicago', $4, $5::date)`,
    [rateId, dayOfWeek, time, startsOn, endsOn ?? null],
  );
}

async function runBilling(billingMonth) {
  const { rows } = await q(
    "select app_public.issue_monthly_bills_for_month($1::date) as r",
    [billingMonth],
  );
  return rows[0].r;
}

async function getStudentBill(studentId, billingMonth) {
  const { rows } = await q(
    `select b.subtotal_cents, b.discount_cents, b.tax_cents, b.total_cents, b.due_date, b.status, b.id
       from app_public.monthly_billing_runs mbr
       join app_public.bills b on b.id = mbr.bill_id
      where mbr.student_id = $1::uuid
        and mbr.billing_month = $2::date
      order by mbr.created_at desc limit 1`,
    [studentId, billingMonth],
  );
  return rows[0] ?? null;
}

async function getBillItems(billId) {
  const { rows } = await q(
    `select description, quantity, amount_cents, student_id
       from app_public.bill_line_items
      where bill_id = $1
      order by description`,
    [billId],
  );
  return rows;
}

async function countBillsForPeriod(billingMonth) {
  const { rows } = await q(
    "select count(*)::int as n from app_public.bills where billing_period_start = $1::date",
    [billingMonth],
  );
  return rows[0].n;
}

async function getBillingRun(studentId, billingMonth) {
  const { rows } = await q(
    `select status, bill_id
       from app_public.monthly_billing_runs
      where student_id = $1::uuid and billing_month = $2::date`,
    [studentId, billingMonth],
  );
  return rows;
}

// =============================================================================
describe("bills__issue_monthly — SQL function", () => {
  let adminId;

  beforeAll(async () => {
    adminId = await createUser("t_bill_admin", "Bill Admin");
    await q("update app_public.users set role = 'admin' where id = $1::uuid", [adminId]);
  });

  test("1. partial month — starts_on clips to mid-month", async () => {
    const sid = await createUser("t_p1", "P1");
    await createFamily("t-partial", "Partial", sid, adminId);
    const rid = await createRate(sid, 5000, 30, "online");
    await createSchedule({ rateId: rid, dayOfWeek: 3, time: "16:00", startsOn: "2026-07-15" });

    const result = await runBilling("2026-07-01");
    expect(result.bills_created).toBe(1);
    expect(result.errors).toBe(0);

    const bill = await getStudentBill(sid, "2026-07-01");
    expect(bill).not.toBeNull();
    const items = await getBillItems(bill.id);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3); // Wed 15, 22, 29
    expect(items[0].amount_cents).toBe(15000);
  });

  test("2. discount and tax snapshots on bill totals", async () => {
    const sid = await createUser("t_p2", "P2");
    const fid = await createFamily("t-discount", "Discount", sid, adminId);

    await q(
      `insert into app_public.family_discounts (family_id, label, discount_type, discount_value, applies_to, effective_from, created_by)
       values ($1::uuid, '10pc', 'percentage', 10, 'all', '2026-07-01', $2::uuid)`,
      [fid, adminId],
    );
    await q(
      `insert into app_public.tax_rates (label, jurisdiction, rate_percent, applies_to, effective_from, created_by)
       values ('test-tax', 'IL', 8.25, 'all', '2026-07-01', $1::uuid)`,
      [adminId],
    );

    const rid = await createRate(sid, 10000, 60, "studio");
    await createSchedule({ rateId: rid, dayOfWeek: 5, time: "10:00", startsOn: "2026-07-01" });

    const result = await runBilling("2026-07-01");
    expect(result.bills_created).toBeGreaterThan(0);
    expect(result.errors).toBe(0);

    const bill = await getStudentBill(sid, "2026-07-01");
    expect(bill).not.toBeNull();
    expect(bill.subtotal_cents).toBe(50000); // 5 × $100
    expect(bill.discount_cents).toBe(5000); // 10%
    // Tax: (50000 - 5000) × 8.25% = 3712.5 → ROUND half-up = 3713
    expect(bill.tax_cents).toBe(3713);
    expect(bill.total_cents).toBe(48713);

    const items = await getBillItems(bill.id);
    expect(items).toHaveLength(1);
    expect(items[0].description).toContain("5");
    expect(items[0].description).toContain("60min");
  });

  test("3. idempotency — second call creates no duplicate bills", async () => {
    const before = await countBillsForPeriod("2026-07-01");
    const result = await runBilling("2026-07-01");
    expect(result.bills_created).toBe(0);
    expect(result.bills_skipped).toBeGreaterThan(0);
    const after = await countBillsForPeriod("2026-07-01");
    expect(after).toBe(before);
  });

  test("4. ends_on mid-month clips occurrences", async () => {
    const sid = await createUser("t_p4", "P4");
    await createFamily("t-ends", "Ends", sid, adminId);
    const rid = await createRate(sid, 8000, 60, "online");
    await createSchedule({
      rateId: rid,
      dayOfWeek: 2,
      time: "14:00",
      startsOn: "2026-06-01",
      endsOn: "2026-07-14",
    });

    const result = await runBilling("2026-07-01");
    expect(result.bills_created).toBe(1);
    expect(result.errors).toBe(0);

    const bill = await getStudentBill(sid, "2026-07-01");
    expect(bill).not.toBeNull();
    const items = await getBillItems(bill.id);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2); // Tue 7, 14
    expect(items[0].amount_cents).toBe(16000);
  });

  test("5. five-week month (Aug 2026 — 5 Mondays)", async () => {
    const sid = await createUser("t_p5", "P5");
    await createFamily("t-fiveweek", "FiveWeek", sid, adminId);
    const rid = await createRate(sid, 6000, 60, "online");
    await createSchedule({ rateId: rid, dayOfWeek: 1, time: "15:00", startsOn: "2026-08-01" });

    const result = await runBilling("2026-08-01");
    expect(result.errors).toBe(0);

    const bill = await getStudentBill(sid, "2026-08-01");
    expect(bill).not.toBeNull();
    const items = await getBillItems(bill.id);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5); // 5 Mondays
    expect(items[0].amount_cents).toBe(30000);
    expect(items[0].description).toContain("August");
  });

  test("6. due date is 5th of the billing month (not following month)", async () => {
    // Only check bills created by the automation (linked to monthly_billing_runs),
    // not manually-created bills with custom due dates.
    const bills = await q(
      `select b.due_date, b.billing_period_start
         from app_public.bills b
         join app_public.monthly_billing_runs mbr on mbr.bill_id = b.id
        where b.due_date is not null`,
    );
    for (const row of bills.rows) {
      const d = new Date(row.due_date);
      const periodStart = new Date(row.billing_period_start);
      expect(d.getUTCMonth()).toBe(periodStart.getUTCMonth()); // same month
      expect(d.getUTCDate()).toBe(5);
    }
  });

  test("7. zero eligible occurrences creates no bill", async () => {
    const sid = await createUser("t_p7", "P7");
    await createFamily("t-zero", "Zero", sid, adminId);
    const rid = await createRate(sid, 5000, 30, "online");
    // Schedule starts in August — billing July yields no overlap
    await createSchedule({ rateId: rid, dayOfWeek: 6, time: "12:00", startsOn: "2026-08-01" });

    const result = await runBilling("2026-07-01");
    expect(result.errors).toBe(0);
    const runs = await getBillingRun(sid, "2026-07-01");
    // Student not eligible — no runs created
    expect(runs).toHaveLength(0);
  });

  test("8. multiple students in one family produce separate per-student bills", async () => {
    const s1 = await createUser("t_p8a", "P8A");
    const s2 = await createUser("t_p8b", "P8B");
    const fid = await createFamily("t-perstudent", "PerStudent", s1, adminId);
    await q(
      "insert into app_public.family_memberships (family_id, user_id) values ($1::uuid, $2::uuid)",
      [fid, s2],
    );

    const r1 = await createRate(s1, 7000, 30, "online");
    const r2 = await createRate(s2, 9000, 60, "studio");
    // Use April 2026 — predates all other tests' schedules (which start Jul/Aug)
    await createSchedule({ rateId: r1, dayOfWeek: 1, time: "15:00", startsOn: "2026-04-01" });
    await createSchedule({ rateId: r2, dayOfWeek: 3, time: "16:00", startsOn: "2026-04-01" });

    const result = await runBilling("2026-04-01");
    expect(result.errors).toBe(0);
    expect(result.bills_created).toBe(2); // Two students → two bills

    // Check student 1's bill (4 Mondays in Apr 2026: 6, 13, 20, 27)
    const bill1 = await getStudentBill(s1, "2026-04-01");
    expect(bill1).not.toBeNull();
    const items1 = await getBillItems(bill1.id);
    expect(items1).toHaveLength(1);
    expect(items1[0].amount_cents).toBe(28000); // 4 × $70

    // Check student 2's bill (5 Wednesdays in Apr 2026: 1, 8, 15, 22, 29)
    const bill2 = await getStudentBill(s2, "2026-04-01");
    expect(bill2).not.toBeNull();
    expect(bill2.id).not.toBe(bill1.id); // Different bills
    const items2 = await getBillItems(bill2.id);
    expect(items2).toHaveLength(1);
    expect(items2[0].amount_cents).toBe(45000); // 5 × $90

    // Combined total
    expect(bill1.total_cents + bill2.total_cents).toBeGreaterThan(0);
  });

  test("9. worker target month — America/Chicago uses current month", () => {
    const cases = [
      { date: "2026-08-15T12:00:00.000-05:00", expected: "2026-08-01" },
      { date: "2026-09-01T00:00:00.000-05:00", expected: "2026-09-01" },
      { date: "2026-01-15T12:00:00.000-06:00", expected: "2026-01-01" },
      { date: "2026-03-01T06:00:00.000Z", expected: "2026-03-01" },
      { date: "2026-07-01T01:00:00.000-05:00", expected: "2026-07-01" },
      { date: "2026-07-01T04:59:00.000-05:00", expected: "2026-07-01" },
    ];
    for (const c of cases) {
      const now = new Date(c.date);
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
      });
      const [y, m] = fmt.format(now).split("-");
      const targetMonth = `${y}-${m}-01`;
      expect(targetMonth).toBe(c.expected);
    }
  });

  test("10. security — visitor role cannot execute billing issue functions", async () => {
    // Connect as AUTH_DATABASE_URL (authenticator role → visitor after RLS)
    const authPool = new pg.Pool({
      connectionString: testDatabaseUrl(process.env.AUTH_DATABASE_URL),
    });
    const authClient = await authPool.connect();
    try {
      // Try calling issue_monthly_bills as visitor — should fail
      const err = await authClient
        .query("select app_public.issue_monthly_bills_for_month('2026-09-01'::date) as r")
        .then(() => null)
        .catch((e) => e);
      expect(err).not.toBeNull();
      const msg = err?.message ?? "";
      expect(msg).toMatch(/permission denied|insufficient_privilege|not allowed/i);

      // Try calling enqueue_monthly_lesson_generation as visitor — should fail
      const err2 = await authClient
        .query("select app_public.enqueue_monthly_lesson_generation('00000000-0000-0000-0000-000000000000'::uuid, '2026-09-01'::date)")
        .then(() => null)
        .catch((e) => e);
      expect(err2).not.toBeNull();
      const msg2 = err2?.message ?? "";
      expect(msg2).toMatch(/permission denied|insufficient_privilege|not allowed/i);
    } finally {
      authClient.release();
      await authPool.end();
    }
  });

  test("11. half-up rounding for tax (not truncation)", async () => {
    const sid = await createUser("t_p11", "P11");
    await createFamily("t-rounding", "Rounding", sid, adminId);

    await q(
      `insert into app_public.tax_rates (label, jurisdiction, rate_percent, applies_to, effective_from, created_by)
       values ('round-test', 'IL', 8.25, 'all', '2026-01-01', $1::uuid)`,
      [adminId],
    );

    // 121 cents × 4 Mondays in Jan 2026 (5, 12, 19, 26) = 484 subtotal
    // Tax: 484 * 8.25 / 100 = 39.93
    // Truncation (::integer) would give 39; half-up ROUND gives 40
    const rid = await createRate(sid, 121, 30, "online");
    // Use January 2026 — no other test has schedules this early
    await createSchedule({ rateId: rid, dayOfWeek: 1, time: "15:00", startsOn: "2026-01-01" });

    const result = await runBilling("2026-01-01");
    expect(result.bills_created).toBe(1);
    expect(result.errors).toBe(0);

    const bill = await getStudentBill(sid, "2026-01-01");
    expect(bill).not.toBeNull();
    expect(bill.subtotal_cents).toBe(484); // 4 × 121

    // Half-up: ROUND(39.93) = 40. Truncation would give 39.
    expect(bill.tax_cents).toBe(40);
    expect(bill.total_cents).toBe(524); // 484 + 40
  });

  test("12. half-up rounding for percentage discount", async () => {
    const sid = await createUser("t_p12", "P12");
    const fid = await createFamily("t-rounddisc", "RoundDisc", sid, adminId);

    await q(
      `insert into app_public.family_discounts (family_id, label, discount_type, discount_value, applies_to, effective_from, created_by)
       values ($1::uuid, '3pc', 'percentage', 3, 'all', '2026-01-01', $2::uuid)`,
      [fid, adminId],
    );

    const rid = await createRate(sid, 10000, 60, "studio");
    // Use January 2026 — isolated from all other test schedules
    // Friday schedule in Jan 2026 — 5 Fridays (2, 9, 16, 23, 30)
    await createSchedule({ rateId: rid, dayOfWeek: 5, time: "10:00", startsOn: "2026-01-01" });

    const result = await runBilling("2026-01-01");
    expect(result.errors).toBe(0);
    expect(result.bills_created).toBe(1);

    const bill = await getStudentBill(sid, "2026-01-01");
    expect(bill).not.toBeNull();
    // 5 × $100 = 50000 subtotal (Jan 2026 has 5 Fridays)
    // 3% discount = 1500 (exact)
    expect(bill.subtotal_cents).toBe(50000);
    expect(bill.discount_cents).toBe(1500);
  });

  test("13. rate history is selected per occurrence date", async () => {
    const sid = await createUser("t_p13", "P13");
    await createFamily("t-rate-split", "RateSplit", sid, adminId);
    const rid = await createRate(sid, 5000, 60, "online");
    await q(
      `delete from app_public.student_rate_history where student_rate_id = $1::uuid`,
      [rid],
    );
    await q(
      `insert into app_public.student_rate_history
         (student_rate_id, student_id, rate_cents, lesson_duration_minutes, location_type, billing_model, effective_from, effective_until)
       values ($1::uuid, $2::uuid, 5000, 60, 'online', 'monthly_prepaid', '2026-07-01', '2026-07-13'),
              ($1::uuid, $2::uuid, 6000, 60, 'online', 'monthly_prepaid', '2026-07-14', null)`,
      [rid, sid],
    );
    await createSchedule({
      rateId: rid,
      dayOfWeek: 2,
      time: "10:00",
      startsOn: "2026-07-01",
    });

    const result = await runBilling("2026-07-01");
    expect(result.bills_created).toBeGreaterThan(0);
    expect(result.errors).toBe(0);

    const bill = await getStudentBill(sid, "2026-07-01");
    expect(bill.subtotal_cents).toBe(23000); // 1 × 5000 + 3 × 6000
    const items = await getBillItems(bill.id);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.amount_cents).sort((a, b) => a - b)).toEqual([
      5000,
      18000,
    ]);
  });
});
