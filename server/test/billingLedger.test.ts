import { it, expect, describe, beforeAll, afterAll } from "@effect/vitest";
import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import pg from "pg";
import { PgAuthDB, PgRootDB } from "../db.js";
import { BillingLedgerService } from "../services/billingLedgerService.js";
import { withAuthContext } from "../requestDatabase.js";

const billingLedgerTestLayer = Layer.mergeAll(
  BillingLedgerService.layer,
  PgRootDB.Live,
  PgAuthDB.Live,
);

let testDb: pg.Pool;
let adminSessionId: string;
let teacherSessionId: string;
let parentSessionId: string;
let payerId: string;
let creditPayerId: string;
let allocationPayerId: string;
let otherPayerId: string;
let studentId: string;
let adminId: string;

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

describe("Billing ledger foundation", () => {
  beforeAll(async () => {
    const dbUrl = forceIpv4(requiredEnv("DATABASE_URL"));

    await runPlatform(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.makeDirectory("generated", { recursive: true });
      }),
    );

    testDb = new pg.Pool({ connectionString: dbUrl });

    // Create users
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

    adminId = await makeUser("ledger_admin", "Ledger Admin", "ledger-admin@test.com", "admin");
    const teacherId = await makeUser(
      "ledger_teacher",
      "Ledger Teacher",
      "ledger-teacher@test.com",
      "teacher",
    );
    const parentId = await makeUser(
      "ledger_parent",
      "Ledger Parent",
      "ledger-parent@test.com",
      "parent",
    );
    studentId = await makeUser(
      "ledger_student",
      "Ledger Student",
      "ledger-student@test.com",
      "student",
    );

    payerId = parentId;
    // Payers with ledgers of their own, so balance assertions see only their rows.
    creditPayerId = await makeUser(
      "ledger_credit_payer",
      "Ledger Credit Payer",
      "ledger-credit-payer@test.com",
      "parent",
    );
    allocationPayerId = await makeUser(
      "ledger_allocation_payer",
      "Ledger Allocation Payer",
      "ledger-allocation-payer@test.com",
      "parent",
    );
    otherPayerId = await makeUser(
      "ledger_other_payer",
      "Ledger Other Payer",
      "ledger-other-payer@test.com",
      "parent",
    );

    const familyResult = await testDb.query(
      `insert into app_public.families (slug, name) values ($1, $2) returning id`,
      ["ledger-family", "Ledger Family"],
    );
    const familyId = familyResult.rows[0].id;

    await testDb.query(
      `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
       values ($1, $2, true, true), ($1, $3, false, false)`,
      [familyId, parentId, studentId],
    );

    // Create sessions
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
  }, 120_000);

  afterAll(async () => {
    await testDb?.end();
  }, 30_000);

  // ======================================================================
  // Bill creation and issue
  // ======================================================================

  it.layer(billingLedgerTestLayer)("Effect-native ledger service coverage", (effectIt) => {
    effectIt.effect("rolls back composed service calls when the caller fails", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const db = yield* PgRootDB;
        const result = yield* Effect.gen(function* () {
          const bill = yield* svc.createBill({
            payerId,
            billingPeriodStart: "2026-08-01",
            billingPeriodEnd: "2026-08-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Caller rollback",
                quantity: 1,
                unitPriceCents: 4500,
                amountCents: 4500,
              },
            ],
          });
          const issued = yield* svc.issueBill(bill.id);
          expect(issued.status).toBe("issued");
          return yield* Effect.fail({ billId: bill.id });
        }).pipe(withAuthContext(adminSessionId), Effect.flip);
        if (!("billId" in result)) {
          return yield* Effect.fail(result);
        }
        const bills = yield* db.execute(
          db.selectFrom("app_public.bills").select("id").where("id", "=", result.billId),
        );
        const audit = yield* db.execute(
          db
            .selectFrom("app_public.financial_audit_events")
            .selectAll()
            .where("record_id", "=", result.billId),
        );
        expect(bills).toEqual([]);
        expect(audit).toEqual([]);
      }),
    );

    effectIt.effect("creates a bill with line items and issues it", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const bill = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-08-01",
            billingPeriodEnd: "2026-08-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Weekly lessons x4",
                quantity: 4,
                unitPriceCents: 4500,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));

        expect(bill.status).toBe("draft");
        expect(bill.payer_id).toBe(payerId);
        expect(bill.bill_number).toBeGreaterThan(0);
        expect(bill.subtotal_cents).toBe(18000);
        expect(bill.total_cents).toBe(18000);

        const loaded = yield* svc.getBill(bill.id).pipe(withAuthContext(adminSessionId));
        expect(loaded).not.toBeNull();
        expect(loaded!.lineItems).toHaveLength(1);
        expect(loaded!.lineItems[0].student_id).toBe(studentId);

        const issued = yield* svc.issueBill(bill.id).pipe(withAuthContext(adminSessionId));
        expect(issued.status).toBe("issued");
        expect(issued.issued_at).not.toBeNull();
      }),
    );

    effectIt.effect("prevents issuing an already-issued bill", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const bill = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-09-01",
            billingPeriodEnd: "2026-09-30",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Weekly lessons x4",
                quantity: 4,
                unitPriceCents: 4500,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        yield* svc.issueBill(bill.id).pipe(withAuthContext(adminSessionId));

        const result = yield* Effect.result(
          svc.issueBill(bill.id).pipe(withAuthContext(adminSessionId)),
        );
        expect(result._tag).toBe("Failure");
      }),
    );

    effectIt.effect("bill stores due_date correctly", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const bill = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-10-01",
            billingPeriodEnd: "2026-10-31",
            dueDate: "2026-10-15",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Weekly lessons x4",
                quantity: 4,
                unitPriceCents: 4500,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));

        expect(bill.due_date).toBe("2026-10-15");
      }),
    );
    effectIt.effect("records a payment with allocation", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const bill = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-11-01",
            billingPeriodEnd: "2026-11-30",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Monthly lessons",
                quantity: 4,
                unitPriceCents: 4500,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        yield* svc.issueBill(bill.id).pipe(withAuthContext(adminSessionId));
        const payment = yield* svc
          .recordPayment({
            payerId,
            amountCents: 18000,
            method: "check",
            reference: "1001",
            notes: "July payment",
            allocations: [{ billId: bill.id, amountCents: 18000 }],
          })
          .pipe(withAuthContext(adminSessionId));

        expect(payment.amount_cents).toBe(18000);
        expect(payment.method).toBe("check");
        expect(payment.reference).toBe("1001");
        const balance = yield* svc.getPayerBalance(payerId).pipe(withAuthContext(adminSessionId));
        expect(balance.creditBalanceCents).toBe(0);
        expect(balance.outstandingCents).toBeGreaterThanOrEqual(0);
      }),
    );

    effectIt.effect("materializes payment excess as one credit", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const db = yield* PgRootDB;
        const bill = yield* svc
          .createBill({
            payerId: creditPayerId,
            billingPeriodStart: "2027-01-01",
            billingPeriodEnd: "2027-01-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "January lesson",
                quantity: 1,
                unitPriceCents: 5000,
                amountCents: 5000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        yield* svc.issueBill(bill.id).pipe(withAuthContext(adminSessionId));
        const payment = yield* svc
          .recordPayment({
            payerId: creditPayerId,
            amountCents: 7000,
            method: "cash",
            allocations: [],
          })
          .pipe(withAuthContext(adminSessionId));
        const credit = yield* db
          .execute(
            db
              .selectFrom("app_public.credits")
              .select(["amount_cents", "source_payment_id"])
              .where("source_payment_id", "=", payment.id),
          )
          .pipe(Effect.head);
        expect(credit).toEqual({
          amount_cents: 2000,
          source_payment_id: payment.id,
        });
        const balance = yield* svc
          .getPayerBalance(creditPayerId)
          .pipe(withAuthContext(adminSessionId));
        expect(balance.creditBalanceCents).toBe(2000);
      }),
    );

    effectIt.effect("auto-allocates the remainder after an explicit allocation", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const db = yield* PgRootDB;
        const bill = yield* svc
          .createBill({
            payerId: allocationPayerId,
            billingPeriodStart: "2026-12-01",
            billingPeriodEnd: "2026-12-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Monthly lessons",
                quantity: 4,
                unitPriceCents: 4500,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        yield* svc.issueBill(bill.id).pipe(withAuthContext(adminSessionId));
        const payment = yield* svc
          .recordPayment({
            payerId: allocationPayerId,
            amountCents: 18000,
            method: "cash",
            allocations: [{ billId: bill.id, amountCents: 5000 }],
          })
          .pipe(withAuthContext(adminSessionId));
        const allocations = yield* db.execute(
          db
            .selectFrom("app_public.payment_allocations")
            .select(["bill_id", "amount_cents"])
            .where("payment_id", "=", payment.id),
        );
        expect(allocations).toEqual([{ bill_id: bill.id, amount_cents: 18000 }]);
      }),
    );

    effectIt.effect("prevents cross-payer allocation", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const bill = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-12-01",
            billingPeriodEnd: "2026-12-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Monthly lessons",
                quantity: 4,
                unitPriceCents: 4500,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        yield* svc.issueBill(bill.id).pipe(withAuthContext(adminSessionId));
        const error = yield* Effect.flip(
          svc
            .recordPayment({
              payerId: otherPayerId,
              amountCents: 18000,
              method: "cash",
              allocations: [{ billId: bill.id, amountCents: 18000 }],
            })
            .pipe(withAuthContext(adminSessionId)),
        );
        expect(error.message).toBe("Cannot allocate across different payers");
      }),
    );

    effectIt.effect("applies a credit to a bill", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const db = yield* PgRootDB;
        const bill = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-12-01",
            billingPeriodEnd: "2026-12-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Monthly lessons",
                quantity: 4,
                unitPriceCents: 4500,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        const credit = yield* db
          .execute(
            db
              .insertInto("app_public.credits")
              .values({
                payer_id: payerId,
                amount_cents: 5000,
                reason: "Referral bonus",
                created_by: adminId,
              })
              .returning("id"),
          )
          .pipe(Effect.head);
        yield* svc.issueBill(bill.id).pipe(withAuthContext(adminSessionId));
        const application = yield* svc
          .applyCredit({
            creditId: credit.id,
            billId: bill.id,
            amountCents: 3000,
          })
          .pipe(withAuthContext(adminSessionId));
        expect(application.bill_id).toBe(bill.id);
        expect(application.amount_cents).toBe(3000);
      }),
    );

    effectIt.effect("prevents applying more than credit remaining", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const db = yield* PgRootDB;
        const bill = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-12-01",
            billingPeriodEnd: "2026-12-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Monthly lessons",
                quantity: 4,
                unitPriceCents: 4500,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        const credit = yield* db
          .execute(
            db
              .insertInto("app_public.credits")
              .values({
                payer_id: payerId,
                amount_cents: 2000,
                reason: "Small credit",
                created_by: adminId,
              })
              .returning("id"),
          )
          .pipe(Effect.head);
        const result = yield* Effect.result(
          svc
            .applyCredit({
              creditId: credit.id,
              billId: bill.id,
              amountCents: 5000,
            })
            .pipe(withAuthContext(adminSessionId)),
        );
        expect(result._tag).toBe("Failure");
      }),
    );

    effectIt.effect("creates an adjustment on an issued bill", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const bill = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-12-01",
            billingPeriodEnd: "2026-12-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Monthly lessons",
                quantity: 4,
                unitPriceCents: 4500,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        yield* svc.issueBill(bill.id).pipe(withAuthContext(adminSessionId));
        const adjustment = yield* svc
          .createAdjustment({
            billId: bill.id,
            amountCents: -5000,
            reason: "Late discount",
          })
          .pipe(withAuthContext(adminSessionId));
        expect(adjustment).toMatchObject({
          bill_id: bill.id,
          amount_cents: -5000,
          reason: "Late discount",
        });
      }),
    );

    effectIt.effect("prevents adjustment on draft bill", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const bill = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-12-01",
            billingPeriodEnd: "2026-12-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Monthly lessons",
                quantity: 4,
                unitPriceCents: 4500,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        const result = yield* Effect.result(
          svc
            .createAdjustment({
              billId: bill.id,
              amountCents: -5000,
              reason: "Late discount",
            })
            .pipe(withAuthContext(adminSessionId)),
        );
        expect(result._tag).toBe("Failure");
      }),
    );

    effectIt.effect("processes a refund and rejects excess refund", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const bill = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-12-01",
            billingPeriodEnd: "2026-12-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Monthly lessons",
                quantity: 4,
                unitPriceCents: 4500,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        yield* svc.issueBill(bill.id).pipe(withAuthContext(adminSessionId));
        const payment = yield* svc
          .recordPayment({
            payerId,
            amountCents: 10000,
            method: "cash",
            allocations: [{ billId: bill.id, amountCents: 10000 }],
          })
          .pipe(withAuthContext(adminSessionId));
        const refund = yield* svc
          .processRefund({
            paymentId: payment.id,
            amountCents: 10000,
            reason: "Full refund",
          })
          .pipe(withAuthContext(adminSessionId));
        expect(refund).toMatchObject({
          payment_id: payment.id,
          amount_cents: 10000,
        });
        const result = yield* Effect.result(
          svc
            .processRefund({
              paymentId: payment.id,
              amountCents: 1,
              reason: "Excess",
            })
            .pipe(withAuthContext(adminSessionId)),
        );
        expect(result._tag).toBe("Failure");
      }),
    );

    effectIt.effect("calculates payer balance and enforces billing RLS", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const balance = yield* svc.getPayerBalance(payerId).pipe(withAuthContext(parentSessionId));
        expect(balance.outstandingCents).toBeGreaterThanOrEqual(0);
        expect(balance.creditBalanceCents).toBeGreaterThanOrEqual(0);
        expect(
          Array.isArray(yield* svc.listPayerBills(payerId).pipe(withAuthContext(teacherSessionId))),
        ).toBe(true);
        const result = yield* Effect.result(
          svc
            .createBill({
              payerId,
              billingPeriodStart: "2026-12-01",
              billingPeriodEnd: "2026-12-31",
              lineItems: [
                {
                  studentId,
                  lineType: "lesson",
                  description: "Should be blocked",
                  quantity: 1,
                  unitPriceCents: 4500,
                  amountCents: 4500,
                },
              ],
            })
            .pipe(withAuthContext(teacherSessionId)),
        );
        expect(result._tag).toBe("Failure");
      }),
    );

    effectIt.effect("bill amounts are immutable after issue", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const db = yield* PgRootDB;
        const bill = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-12-01",
            billingPeriodEnd: "2026-12-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "Monthly lessons",
                quantity: 4,
                unitPriceCents: 4500,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        yield* svc.issueBill(bill.id).pipe(withAuthContext(adminSessionId));
        const result = yield* Effect.result(
          db.execute(
            db
              .updateTable("app_public.bills")
              .set({ total_cents: 99999 })
              .where("id", "=", bill.id),
          ),
        );
        expect(result._tag).toBe("Failure");
      }),
    );

    effectIt.effect("bill numbers are sequential and never reused", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const first = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-07-01",
            billingPeriodEnd: "2026-07-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "July",
                quantity: 1,
                unitPriceCents: 18000,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        const second = yield* svc
          .createBill({
            payerId,
            billingPeriodStart: "2026-08-01",
            billingPeriodEnd: "2026-08-31",
            lineItems: [
              {
                studentId,
                lineType: "lesson",
                description: "August",
                quantity: 1,
                unitPriceCents: 18000,
                amountCents: 18000,
              },
            ],
          })
          .pipe(withAuthContext(adminSessionId));
        expect(second.bill_number).toBeGreaterThan(first.bill_number);
      }),
    );
  });

  // ======================================================================
});
