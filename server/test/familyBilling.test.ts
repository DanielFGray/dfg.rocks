import { runPlatform } from "./framework.js";
import { it, expect, describe, beforeAll, afterAll } from "@effect/vitest";
import * as FileSystem from "effect/FileSystem";
import { Effect, Layer } from "effect";
import pg from "pg";
import { PgAuthDB, PgRootDB } from "../db.js";
import { BillingLedger } from "../services/billingLedger.js";
import { FamilyBilling } from "../services/familyBilling.js";
import { withAuthContext } from "../requestDatabase.js";
import { Pdf } from "../services/pdf.js";

const familyBillingTestLayer = Layer.mergeAll(
  PgRootDB.layer,
  PgAuthDB.layer,
  BillingLedger.layer,
  Pdf.layer,
  FamilyBilling.layer.pipe(Layer.provide(Layer.mergeAll(Pdf.layer, BillingLedger.layer))),
);

import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let testDb: pg.Pool;
let adminSessionId: string;
let teacherSessionId: string;
let parentSessionId: string;
let otherParentSessionId: string;
let studentSessionId: string;
let otherFamilyId: string;
let studentId: string;
let adminId: string;
let seededBillId: string;

async function makeUser(
  username: string,
  name: string,
  email: string,
  role: string,
): Promise<string> {
  const result = await testDb.query(
    `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
    [username, name, email, `${username}123`],
  );
  await testDb.query(`update app_public.users set role = $1 where id = $2`, [
    role,
    result.rows[0].id,
  ]);
  return result.rows[0].id;
}

/**
 * Runs `fn` in one transaction, as the session's user when one is given. A deferred
 * billing-contact refusal surfaces from COMMIT, so the commit sits inside the try.
 */
async function inTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  sessionId?: string,
): Promise<T> {
  const client = await testDb.connect();
  try {
    await client.query("begin");
    if (sessionId) {
      await client.query("select set_config('my.session_id', $1, true)", [sessionId]);
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Resolves once another backend holds a lock the given backend waits on. Uses
 * pg_blocking_pids because pg_stat_activity's wait columns are not reported here. Yields
 * to the event loop between checks, so the other side of the race runs.
 */
async function waitUntilBlocked(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100_000; attempt++) {
    const blocked = await testDb.query<{ blocked: boolean }>(
      "select cardinality(pg_blocking_pids($1)) > 0 as blocked",
      [pid],
    );
    if (blocked.rows[0].blocked) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("backend never blocked on a lock");
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function forceIpv4(urlString: string): string {
  const url = new URL(urlString);
  if (url.hostname === "localhost" || url.hostname === "::1") url.hostname = "127.0.0.1";
  return url.toString();
}

function extractPdfText(pdfBuffer: Buffer): string {
  const tmpPath = join(
    tmpdir(),
    `pdf-test-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  try {
    writeFileSync(tmpPath, pdfBuffer);
    return execSync(`pdftotext "${tmpPath}" -`, { encoding: "utf8", timeout: 5000 });
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

describe("PDF Service", () => {
  beforeAll(async () => {
    const dbUrl = forceIpv4(requiredEnv("DATABASE_URL"));

    await runPlatform(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.makeDirectory("generated", { recursive: true });
      }),
    );

    testDb = new pg.Pool({ connectionString: dbUrl });

    adminId = await makeUser("fb_admin", "FB Admin", "fbadmin@test.com", "admin");
    const teacherId = await makeUser("fb_teacher", "FB Teacher", "fbteacher@test.com", "teacher");
    const parentId = await makeUser("fb_parent", "FB Parent", "fbparent@test.com", "parent");
    const otherParentId = await makeUser(
      "fb_other_parent",
      "FB Other Parent",
      "fbother@test.com",
      "parent",
    );
    studentId = await makeUser("fb_student", "FB Student", "fbstudent@test.com", "student");

    const familyResult = await testDb.query(
      `insert into app_public.families (slug, name) values ($1, $2) returning id`,
      ["fb-test-family", "FB Test Family"],
    );
    const familyId = familyResult.rows[0].id;

    const otherFamilyResult = await testDb.query(
      `insert into app_public.families (slug, name) values ($1, $2) returning id`,
      ["fb-other-family", "FB Other Family"],
    );
    otherFamilyId = otherFamilyResult.rows[0].id;

    await testDb.query(
      `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
       values ($1, $2, true, true), ($1, $3, false, false)`,
      [familyId, parentId, studentId],
    );

    await testDb.query(
      `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
       values ($1, $2, true, true)`,
      [otherFamilyId, otherParentId],
    );

    const createSession = async (userId: string) => {
      const result = await testDb.query(
        `insert into app_private.sessions (user_id) values ($1) returning id`,
        [userId],
      );
      return result.rows[0].id;
    };

    adminSessionId = await createSession(adminId);
    teacherSessionId = await createSession(teacherId);
    parentSessionId = await createSession(parentId);
    otherParentSessionId = await createSession(otherParentId);
    studentSessionId = await createSession(studentId);

    // Seed a bill and payment for testing
    const billResult = await testDb.query(
      `insert into app_public.bills (payer_id, bill_number, billing_period_start, billing_period_end, due_date, subtotal_cents, discount_cents, tax_cents, total_cents, notes, status, created_at)
       values ($1, app_public.next_bill_number(), '2026-07-01', '2026-07-31', '2026-07-15', 20000, 2000, 1000, 19000, null::text, 'draft', now())
       returning id`,
      [parentId],
    );
    seededBillId = billResult.rows[0].id;

    await testDb.query(
      `update app_public.bills set status = 'issued', issued_at = now() where id = $1`,
      [seededBillId],
    );

    await testDb.query(
      `insert into app_public.bill_line_items (bill_id, student_id, line_type, description, quantity, unit_price_cents, amount_cents)
       values ($1, $2, 'lesson', 'Weekly lessons x4', 4, 5000, 20000)`,
      [seededBillId, studentId],
    );

    const paymentResult = await testDb.query(
      `insert into app_public.payments (payer_id, payment_number, amount_cents, method, reference, received_at, notes)
       values ($1, 1, 10000, 'check', 'CK-1001', now(), null::text)
       returning id`,
      [parentId],
    );
    const paymentId = paymentResult.rows[0].id;

    await testDb.query(
      `insert into app_public.payment_allocations (payment_id, bill_id, amount_cents)
       values ($1, $2, 10000)`,
      [paymentId, seededBillId],
    );

    // Credit for testing
    await testDb.query(
      `insert into app_public.credits (payer_id, amount_cents, reason, created_by)
       values ($1, 5000, 'Referral bonus', $2)`,
      [parentId, adminId],
    );
  }, 120_000);

  afterAll(async () => {
    await testDb?.end();
  }, 30_000);

  // Service-backed coverage runs directly on the Effect database layer.
  it.layer(familyBillingTestLayer)("family billing services", (effectIt) => {
    effectIt.effect("renders bill and receipt PDFs", () =>
      Effect.gen(function* () {
        const pdf = yield* Pdf;
        const billBuffer = yield* pdf.generateBillPdf({
          payerName: "Test Payer",
          billNumber: 42,
          status: "issued",
          billingPeriodStart: "2026-07-01",
          billingPeriodEnd: "2026-07-31",
          dueDate: "2026-07-15",
          issuedAt: "2026-07-01",
          paidAt: null,
          createdAt: "2026-07-01",
          lineItems: [
            {
              description: "Weekly lessons x4",
              lineType: "lesson",
              quantity: 4,
              unitPriceCents: 5000,
              amountCents: 20000,
            },
          ],
          subtotalCents: 20000,
          discountCents: 2000,
          taxCents: 1000,
          totalCents: 19000,
        });
        expect(billBuffer.slice(0, 4).toString()).toBe("%PDF");
        expect(extractPdfText(billBuffer)).toContain("$190.00");

        const receiptBuffer = yield* pdf.generateReceiptPdf({
          payerName: "Test Payer",
          paymentNumber: 1,
          amountCents: 10000,
          method: "check",
          reference: "CK-1001",
          receivedAt: "2026-07-05",
          allocations: [{ billNumber: 42, amountCents: 10000 }],
        });
        expect(receiptBuffer.slice(0, 4).toString()).toBe("%PDF");
        expect(extractPdfText(receiptBuffer)).toContain("Receipt #1");
      }),
    );

    effectIt.effect("parent reads their own billing overview and lists", () =>
      Effect.gen(function* () {
        const svc = yield* FamilyBilling;
        const overview = yield* svc.overview().pipe(withAuthContext(parentSessionId));
        expect(overview.balance.gross_outstanding_cents).toBeGreaterThanOrEqual(19000);
        const bills = yield* svc.bills().pipe(withAuthContext(parentSessionId));
        expect(bills.length).toBeGreaterThanOrEqual(1);
        const detail = yield* svc.billDetail(bills[0].id).pipe(withAuthContext(parentSessionId));
        expect(detail.lineItems.length).toBeGreaterThanOrEqual(1);
        expect(
          (yield* svc.payments().pipe(withAuthContext(parentSessionId))).length,
        ).toBeGreaterThanOrEqual(1);
        expect(
          (yield* svc.credits().pipe(withAuthContext(parentSessionId))).some(
            (c) => c.reason === "Referral bonus",
          ),
        ).toBe(true);
      }),
    );

    effectIt.effect("a family member who is not the payer sees the billing contact's bills", () =>
      Effect.gen(function* () {
        const svc = yield* FamilyBilling;
        const bills = yield* svc.bills().pipe(withAuthContext(studentSessionId));
        expect(bills.map((bill) => bill.id)).toContain(seededBillId);
      }),
    );

    effectIt.effect("parent can download their bill and payment receipt", () =>
      Effect.gen(function* () {
        const svc = yield* FamilyBilling;
        const billPdf = yield* svc.billPdf(seededBillId).pipe(withAuthContext(parentSessionId));
        expect(billPdf.slice(0, 4).toString()).toBe("%PDF");
        expect(extractPdfText(billPdf)).toContain("Payer: FB Parent");
        const payments = yield* svc.payments().pipe(withAuthContext(parentSessionId));
        const receipt = yield* svc
          .paymentReceipt(payments[0].id)
          .pipe(withAuthContext(parentSessionId));
        expect(receipt.slice(0, 4).toString()).toBe("%PDF");
        expect(extractPdfText(receipt)).toContain("Receipt");
      }),
    );

    effectIt.effect("admin can download billing documents", () =>
      Effect.gen(function* () {
        const svc = yield* FamilyBilling;
        const payments = yield* svc.payments().pipe(withAuthContext(parentSessionId));
        expect(
          (yield* svc.billPdf(seededBillId).pipe(withAuthContext(adminSessionId)))
            .slice(0, 4)
            .toString(),
        ).toBe("%PDF");
        expect(
          (yield* svc.paymentReceipt(payments[0].id).pipe(withAuthContext(adminSessionId)))
            .slice(0, 4)
            .toString(),
        ).toBe("%PDF");
      }),
    );

    effectIt.effect("teacher and another family cannot access billing documents", () =>
      Effect.gen(function* () {
        const svc = yield* FamilyBilling;
        const teacherError = yield* Effect.flip(
          svc.billPdf(seededBillId).pipe(withAuthContext(teacherSessionId)),
        );
        expect(teacherError.message).toBe("Bill not found");
        expect(yield* svc.bills().pipe(withAuthContext(otherParentSessionId))).toEqual([]);
        const otherError = yield* Effect.flip(
          svc.billPdf(seededBillId).pipe(withAuthContext(otherParentSessionId)),
        );
        expect(otherError.message).toBe("Bill not found");
        const otherDetailError = yield* Effect.flip(
          svc.billDetail(seededBillId).pipe(withAuthContext(otherParentSessionId)),
        );
        expect(otherDetailError.message).toBe("Bill not found");
        const missingError = yield* Effect.flip(
          svc
            .billPdf("00000000-0000-0000-0000-000000000000")
            .pipe(withAuthContext(parentSessionId)),
        );
        expect(missingError.message).toBe("Bill not found");
      }),
    );
  });

  it("a student cannot join a second family", async () => {
    await expect(
      testDb.query(
        `insert into app_public.family_memberships (family_id, user_id) values ($1, $2)`,
        [otherFamilyId, studentId],
      ),
    ).rejects.toMatchObject({ code: "DNIED" });
  });
});

describe("family billing contact", () => {
  // Each test builds its own families and users under unique names, so tests share no state.
  const unique = (label: string) => `${label}_${Math.random().toString(36).slice(2, 10)}`;

  let staffId: string;
  let staffSessionId: string;

  beforeAll(async () => {
    testDb = new pg.Pool({ connectionString: forceIpv4(requiredEnv("DATABASE_URL")) });
    const name = unique("fbc_staff");
    staffId = await makeUser(name, "Billing Staff", `${name}@test.com`, "admin");
    const session = await testDb.query(
      `insert into app_private.sessions (user_id) values ($1) returning id`,
      [staffId],
    );
    staffSessionId = session.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await testDb?.end();
  }, 30_000);

  const newUser = (label: string, role: string) => {
    const username = unique(label);
    return makeUser(username, label, `${username}@test.com`, role);
  };
  const parent = (label: string) => newUser(label, "parent");
  const student = (label: string) => newUser(label, "student");

  /** Staff create a family as the signed-in staff user, so the function's role check runs. */
  async function staffFamily(): Promise<string> {
    const result = await inTransaction(
      (client) =>
        client.query<{ id: string }>(`select id from app_public.create_family($1, $2)`, [
          unique("fbc-family"),
          "Billing Family",
        ]),
      staffSessionId,
    );
    return result.rows[0].id;
  }

  const addStudent = (familyId: string, studentId: string) =>
    testDb.query(`insert into app_public.family_memberships (family_id, user_id) values ($1, $2)`, [
      familyId,
      studentId,
    ]);

  async function billingContactOf(familyId: string): Promise<string | null> {
    const result = await testDb.query<{ user_id: string }>(
      `select user_id from app_public.family_memberships where family_id = $1 and is_billing_contact`,
      [familyId],
    );
    return result.rows[0]?.user_id ?? null;
  }

  const transferTo = (familyId: string, userId: string) =>
    inTransaction(
      (client) =>
        client.query(`select app_public.transfer_family_billing_contact($1, $2)`, [
          familyId,
          userId,
        ]),
      staffSessionId,
    );

  it("staff who create a family own it but are not its billing contact", async () => {
    const familyId = await staffFamily();
    const memberships = await testDb.query(
      `select user_id, is_owner, is_billing_contact from app_public.family_memberships where family_id = $1`,
      [familyId],
    );
    expect(memberships.rows).toEqual([
      { user_id: staffId, is_owner: true, is_billing_contact: false },
    ]);
  });

  it("the first parent to join becomes billing contact, and later parents do not", async () => {
    const familyId = await staffFamily();
    const firstParent = await parent("fbc_first");
    const secondParent = await parent("fbc_second");

    await testDb.query("select app_private.join_family($1, $2)", [familyId, firstParent]);
    await testDb.query("select app_private.join_family($1, $2)", [familyId, secondParent]);

    expect(await billingContactOf(familyId)).toBe(firstParent);
  });

  it("a student cannot join a family whose billing contact is not a parent", async () => {
    const familyId = await staffFamily();
    const kid = await student("fbc_kid");

    await expect(addStudent(familyId, kid)).rejects.toMatchObject({ code: "BLCNT" });
  });

  it("a student joins once a parent is the billing contact", async () => {
    const familyId = await staffFamily();
    const guardian = await parent("fbc_guardian");
    const kid = await student("fbc_joins");
    await testDb.query("select app_private.join_family($1, $2)", [familyId, guardian]);

    await addStudent(familyId, kid);

    const membership = await testDb.query(
      `select user_id from app_public.family_memberships where family_id = $1 and user_id = $2`,
      [familyId, kid],
    );
    expect(membership.rows).toEqual([{ user_id: kid }]);
    expect(await billingContactOf(familyId)).toBe(guardian);
  });

  it("billing contact transfers to a parent, and is refused for a student or staff", async () => {
    const familyId = await staffFamily();
    const guardian = await parent("fbc_xfer_from");
    const otherGuardian = await parent("fbc_xfer_to");
    const kid = await student("fbc_xfer_kid");
    await testDb.query("select app_private.join_family($1, $2)", [familyId, guardian]);
    await testDb.query("select app_private.join_family($1, $2)", [familyId, otherGuardian]);
    await addStudent(familyId, kid);

    await transferTo(familyId, otherGuardian);
    expect(await billingContactOf(familyId)).toBe(otherGuardian);

    await expect(transferTo(familyId, kid)).rejects.toMatchObject({ code: "BLCNT" });
    await expect(transferTo(familyId, staffId)).rejects.toMatchObject({ code: "BLCNT" });
    expect(await billingContactOf(familyId)).toBe(otherGuardian);
  });

  it("removing the billing contact while students remain is refused until a transfer", async () => {
    const familyId = await staffFamily();
    const guardian = await parent("fbc_rm_from");
    const otherGuardian = await parent("fbc_rm_to");
    const kid = await student("fbc_rm_kid");
    await testDb.query("select app_private.join_family($1, $2)", [familyId, guardian]);
    await testDb.query("select app_private.join_family($1, $2)", [familyId, otherGuardian]);
    await addStudent(familyId, kid);

    const remove = () =>
      inTransaction(
        (client) =>
          client.query(`select app_public.remove_from_family($1, $2)`, [familyId, guardian]),
        staffSessionId,
      );
    await expect(remove()).rejects.toMatchObject({ code: "BLCNT" });

    await transferTo(familyId, otherGuardian);
    await remove();

    const remaining = await testDb.query(
      `select user_id from app_public.family_memberships where family_id = $1 and user_id = $2`,
      [familyId, guardian],
    );
    expect(remaining.rows).toEqual([]);
  });

  it("deleting the billing contact while students remain is refused until a transfer", async () => {
    const familyId = await staffFamily();
    const guardian = await parent("fbc_del_from");
    const otherGuardian = await parent("fbc_del_to");
    const kid = await student("fbc_del_kid");
    await testDb.query("select app_private.join_family($1, $2)", [familyId, guardian]);
    await testDb.query("select app_private.join_family($1, $2)", [familyId, otherGuardian]);
    await addStudent(familyId, kid);

    await expect(
      testDb.query(`delete from app_public.users where id = $1`, [guardian]),
    ).rejects.toMatchObject({
      code: "BLCNT",
    });

    await transferTo(familyId, otherGuardian);
    await testDb.query(`delete from app_public.users where id = $1`, [guardian]);
    expect(await billingContactOf(familyId)).toBe(otherGuardian);
  });

  it("a billing contact whose role changes away from parent is refused while students remain", async () => {
    const familyId = await staffFamily();
    const guardian = await parent("fbc_role");
    const kid = await student("fbc_role_kid");
    await testDb.query("select app_private.join_family($1, $2)", [familyId, guardian]);
    await addStudent(familyId, kid);

    await expect(
      testDb.query(`update app_public.users set role = 'teacher' where id = $1`, [guardian]),
    ).rejects.toMatchObject({ code: "BLCNT" });
  });

  it("two students added to one family in concurrent transactions both commit", async () => {
    const familyId = await staffFamily();
    const guardian = await parent("fbc_conc_guardian");
    await testDb.query("select app_private.join_family($1, $2)", [familyId, guardian]);
    const kids = [await student("fbc_conc_a"), await student("fbc_conc_b")];

    // Each transaction runs on its own connection. Every membership insert takes the
    // realtime advisory lock until commit, so the second insert waits for the first commit.
    // Neither waits on the other while open, so the test cannot stall.
    const outcomes = await Promise.allSettled(
      kids.map((kid) =>
        inTransaction((client) =>
          client.query(
            `insert into app_public.family_memberships (family_id, user_id) values ($1, $2)`,
            [familyId, kid],
          ),
        ),
      ),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "fulfilled"]);

    const members = await testDb.query(
      `select user_id from app_public.family_memberships where family_id = $1 and user_id = any($2::uuid[])`,
      [familyId, kids],
    );
    expect(members.rows).toHaveLength(2);
  });

  it("two parents joining one empty family at once: both join, exactly one is billing contact", async () => {
    const familyId = await staffFamily();
    const parents = [await parent("fbc_race_a"), await parent("fbc_race_b")];

    // The first join stays open while the second starts, so the second must read the family
    // before the first commits. It proceeds only after the first commits.
    const first = await testDb.connect();
    const second = await testDb.connect();
    try {
      await first.query("begin");
      await first.query("select app_private.join_family($1, $2)", [familyId, parents[0]]);
      await second.query("begin");
      // Read the PID before the join: a query sent while the join waits would queue behind it.
      const secondPid = (await second.query<{ pid: number }>("select pg_backend_pid() as pid"))
        .rows[0].pid;
      const joining = second.query("select app_private.join_family($1, $2)", [
        familyId,
        parents[1],
      ]);
      await waitUntilBlocked(secondPid);
      await first.query("commit");
      await joining;
      await second.query("commit");
    } finally {
      await first.query("rollback").catch(() => undefined);
      await second.query("rollback").catch(() => undefined);
      first.release();
      second.release();
    }

    const members = await testDb.query(
      `select user_id, is_billing_contact from app_public.family_memberships where family_id = $1 and user_id = any($2::uuid[])`,
      [familyId, parents],
    );
    expect(members.rows).toHaveLength(2);
    expect(members.rows.filter((row) => row.is_billing_contact)).toHaveLength(1);
  });
});
