import { it, expect, describe, beforeAll, afterAll } from "@effect/vitest";
import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import pg from "pg";
import { PgAuthDB, PgRootDB } from "../db.js";
import { BillingLedgerService } from "../services/billingLedgerService.js";
import { FamilyBillingService } from "../services/familyBillingService.js";
import { PdfService } from "../services/pdfService.js";

const familyBillingTestLayer = Layer.mergeAll(
  PgRootDB.Live,
  PgAuthDB.Live,
  BillingLedgerService.layer,
  PdfService.layer,
  FamilyBillingService.layer.pipe(
    Layer.provide(Layer.mergeAll(PdfService.layer, BillingLedgerService.layer)),
  ),
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
let familyId: string;
let otherFamilyId: string;
let studentId: string;
let adminId: string;
let parentUserId: string;
let otherParentUserId: string;

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

function runPlatform<A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
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
    parentUserId = parentId;
    const otherParentId = await makeUser(
      "fb_other_parent",
      "FB Other Parent",
      "fbother@test.com",
      "parent",
    );
    otherParentUserId = otherParentId;
    studentId = await makeUser("fb_student", "FB Student", "fbstudent@test.com", "student");

    const familyResult = await testDb.query(
      `insert into app_public.families (slug, name) values ($1, $2) returning id`,
      ["fb-test-family", "FB Test Family"],
    );
    familyId = familyResult.rows[0].id;

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

    // Seed a bill and payment for testing
    const billResult = await testDb.query(
      `insert into app_public.bills (family_id, bill_number, billing_period_start, billing_period_end, due_date, subtotal_cents, discount_cents, tax_cents, total_cents, notes, status, created_at)
       values ($1, app_public.next_bill_number($1::uuid), '2026-07-01', '2026-07-31', '2026-07-15', 20000, 2000, 1000, 19000, null::text, 'draft', now())
       returning id`,
      [familyId],
    );
    const billId = billResult.rows[0].id;

    await testDb.query(
      `update app_public.bills set status = 'issued', issued_at = now() where id = $1`,
      [billId],
    );

    await testDb.query(
      `insert into app_public.bill_line_items (bill_id, student_id, line_type, description, quantity, unit_price_cents, amount_cents)
       values ($1, $2, 'lesson', 'Weekly lessons x4', 4, 5000, 20000)`,
      [billId, studentId],
    );

    const paymentResult = await testDb.query(
      `insert into app_public.payments (family_id, payment_number, amount_cents, method, reference, received_at, notes)
       values ($1, 1, 10000, 'check', 'CK-1001', now(), null::text)
       returning id`,
      [familyId],
    );
    const paymentId = paymentResult.rows[0].id;

    await testDb.query(
      `insert into app_public.payment_allocations (payment_id, bill_id, amount_cents)
       values ($1, $2, 10000)`,
      [paymentId, billId],
    );

    // Credit for testing
    await testDb.query(
      `insert into app_public.family_credits (family_id, amount_cents, reason, created_by)
       values ($1, 5000, 'Referral bonus', $2)`,
      [familyId, adminId],
    );
  }, 120_000);

  afterAll(async () => {
    await testDb?.end();
  }, 30_000);

  // Service-backed coverage runs directly on the Effect database layer.
  it.layer(familyBillingTestLayer)("family billing services", (effectIt) => {
    effectIt.effect("renders bill and receipt PDFs", () =>
      Effect.gen(function* () {
        const pdf = yield* PdfService;
        const billBuffer = yield* pdf.generateBillPdf({
          familyName: "Test Family",
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
          familyName: "Test Family",
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
        const svc = yield* FamilyBillingService;
        const overview = yield* svc.overview(parentSessionId, parentUserId);
        expect(overview.family_id).toBe(familyId);
        expect(overview.family_name).toBe("FB Test Family");
        expect(overview.balance.gross_outstanding_cents).toBeGreaterThanOrEqual(19000);
        const bills = yield* svc.bills(parentSessionId, parentUserId);
        expect(bills.length).toBeGreaterThanOrEqual(1);
        const detail = yield* svc.billDetail(parentSessionId, parentUserId, bills[0].id);
        expect(detail.lineItems.length).toBeGreaterThanOrEqual(1);
        expect((yield* svc.payments(parentSessionId, parentUserId)).length).toBeGreaterThanOrEqual(
          1,
        );
        expect(
          (yield* svc.credits(parentSessionId, parentUserId)).some(
            (c) => c.reason === "Referral bonus",
          ),
        ).toBe(true);
      }),
    );

    effectIt.effect("parent can download their bill and payment receipt", () =>
      Effect.gen(function* () {
        const svc = yield* FamilyBillingService;
        const bills = yield* svc.bills(parentSessionId, parentUserId);
        const billPdf = yield* svc.billPdf(parentSessionId, parentUserId, bills[0].id);
        expect(billPdf.slice(0, 4).toString()).toBe("%PDF");
        expect(extractPdfText(billPdf)).toContain("FB Test Family");
        const payments = yield* svc.payments(parentSessionId, parentUserId);
        const receipt = yield* svc.paymentReceipt(parentSessionId, parentUserId, payments[0].id);
        expect(receipt.slice(0, 4).toString()).toBe("%PDF");
        expect(extractPdfText(receipt)).toContain("Receipt");
      }),
    );

    effectIt.effect("admin can download billing documents", () =>
      Effect.gen(function* () {
        const svc = yield* FamilyBillingService;
        const bills = yield* svc.bills(parentSessionId, parentUserId);
        const payments = yield* svc.payments(parentSessionId, parentUserId);
        expect((yield* svc.adminBillPdf(adminSessionId, bills[0].id)).slice(0, 4).toString()).toBe(
          "%PDF",
        );
        expect(
          (yield* svc.adminPaymentReceipt(adminSessionId, payments[0].id)).slice(0, 4).toString(),
        ).toBe("%PDF");
      }),
    );

    effectIt.effect("teacher and another family cannot access billing documents", () =>
      Effect.gen(function* () {
        const svc = yield* FamilyBillingService;
        const bills = yield* svc.bills(parentSessionId, parentUserId);
        const teacherResult = yield* Effect.exit(
          svc.billPdf(teacherSessionId, teacherSessionId, bills[0].id),
        );
        expect(teacherResult._tag).toBe("Failure");
        const otherResult = yield* Effect.exit(
          svc.billPdf(otherParentSessionId, otherParentUserId, bills[0].id),
        );
        expect(otherResult._tag).toBe("Failure");
        const otherDetail = yield* Effect.exit(
          svc.billDetail(otherParentSessionId, otherParentUserId, bills[0].id),
        );
        expect(otherDetail._tag).toBe("Failure");
        const missingResult = yield* Effect.exit(
          svc.billPdf(parentSessionId, parentUserId, "00000000-0000-0000-0000-000000000000"),
        );
        expect(missingResult._tag).toBe("Failure");
      }),
    );
  });
});
