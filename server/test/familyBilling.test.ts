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

    const makeUser = async (username: string, name: string, email: string, role: string) => {
      const result = await testDb.query(
        `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
        [username, name, email, `${username}123`],
      );
      await testDb.query(`update app_public.users set role = $1 where id = $2`, [
        role,
        result.rows[0].id,
      ]);
      return result.rows[0].id;
    };

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
