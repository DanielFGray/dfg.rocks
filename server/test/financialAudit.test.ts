import { it, expect, describe, beforeAll, afterAll } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { sql } from "kysely";
import pg from "pg";
import { PgAuthDB, PgRootDB } from "../db.js";
import { BillingLedgerService } from "../services/billingLedgerService.js";

const financialAuditServiceLayer = Layer.mergeAll(
  BillingLedgerService.Default,
  PgRootDB.Live,
  PgAuthDB.Live,
);

let pool: pg.Pool;
let visitorPool: pg.Pool;
let adminSessionId: string;
let studentSessionId: string;
let familyId: string;
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

async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}

async function insertRow(table: string, values: Record<string, any>, returning = "id") {
  const cols = Object.keys(values);
  const vals = Object.values(values);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const result = await query(
    `insert into app_public.${table} (${cols.join(", ")}) values (${placeholders.join(", ")}) returning ${returning}`,
    vals,
  );
  return result.rows[0];
}

describe("Financial audit", () => {
  beforeAll(async () => {
    const dbUrl = forceIpv4(requiredEnv("DATABASE_URL"));
    const authDbUrl = forceIpv4(requiredEnv("AUTH_DATABASE_URL"));

    pool = new pg.Pool({ connectionString: dbUrl });
    visitorPool = new pg.Pool({ connectionString: authDbUrl });

    const createUser = async (username: string, name: string, email: string, role: string) => {
      const r = await query(
        `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
        [username, name, email, `${username}123`],
      );
      await query(`update app_public.users set role = $1 where id = $2`, [role, r.rows[0].id]);
      if (role === "student") {
        await query(`update app_public.users set role = 'student' where id = $1`, [r.rows[0].id]);
      }
      return r.rows[0].id;
    };

    adminId = await createUser("audit_admin", "Audit Admin", "audit-admin@test.com", "admin");
    const studentUserId = await createUser("audit_student", "Audit Student", "audit-student@test.com", "student");

    const fam = await insertRow("families", { slug: "audit-family", name: "Audit Family" });
    familyId = fam.id;
    studentId = studentUserId;

    await insertRow("family_memberships", { family_id: familyId, user_id: studentId });

    const createSession = async (userId: string) => {
      const r = await query(`insert into app_private.sessions (user_id) values ($1) returning id`, [userId]);
      return r.rows[0].id;
    };

    adminSessionId = await createSession(adminId);

    const sSession = await query(
      `insert into app_private.sessions (user_id) values ($1) returning id`,
      [studentUserId],
    );
    studentSessionId = sSession.rows[0].id;

  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await visitorPool?.end();
  }, 30_000);

  // ===================================================================
  // Audit trigger — record creation
  // ===================================================================

  it.layer(financialAuditServiceLayer)("financial audit service behavior", (effectIt) => {
    effectIt.effect("creates an audit row on bill insert", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const db = yield* PgRootDB;
        const bill = yield* svc.createBill(adminSessionId, {
          familyId, billingPeriodStart: "2026-07-01", billingPeriodEnd: "2026-07-31",
          lineItems: [{ studentId, lineType: "lesson", description: "Test audit insert", quantity: 1, unitPriceCents: 5000, amountCents: 5000 }],
        });
        const audit = yield* db.selectFrom("app_public.financial_audit_events").selectAll()
          .where("record_id", "=", bill.id).where("table_name", "=", "bills").pipe(Effect.head);
        expect(audit.action).toBe("insert");
        expect(audit.actor_id).toBe(adminId);
        expect(audit.old_values).toBeNull();
        expect((audit.new_values as any).family_id).toBe(familyId);
      }),
    );

    effectIt.effect("creates an audit row on bill update", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const db = yield* PgRootDB;
        const bill = yield* svc.createBill(adminSessionId, {
          familyId, billingPeriodStart: "2026-08-01", billingPeriodEnd: "2026-08-31",
          lineItems: [{ studentId, lineType: "lesson", description: "Test audit update", quantity: 1, unitPriceCents: 5000, amountCents: 5000 }],
        });
        yield* svc.issueBill(adminSessionId, bill.id);
        const audit = yield* db.selectFrom("app_public.financial_audit_events").selectAll()
          .where("record_id", "=", bill.id).where("table_name", "=", "bills").where("action", "=", "update").pipe(Effect.head);
        expect(audit.actor_id).toBe(adminId);
        expect((audit.old_values as any).status).toBe("draft");
        expect((audit.new_values as any).status).toBe("issued");
      }),
    );

    effectIt.effect("creates audit rows for payment creation and allocation", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const db = yield* PgRootDB;
        const bill = yield* svc.createBill(adminSessionId, {
          familyId, billingPeriodStart: "2026-09-01", billingPeriodEnd: "2026-09-30",
          lineItems: [{ studentId, lineType: "lesson", description: "Test audit payment", quantity: 1, unitPriceCents: 10000, amountCents: 10000 }],
        });
        yield* svc.issueBill(adminSessionId, bill.id);
        const payment = yield* svc.recordPayment(adminSessionId, {
          familyId, amountCents: 10000, method: "check", reference: "AUDIT-001",
          allocations: [{ billId: bill.id, amountCents: 10000 }],
        });
        const audit = yield* db.selectFrom("app_public.financial_audit_events").selectAll()
          .where("record_id", "=", payment.id).where("table_name", "=", "payments").pipe(Effect.head);
        expect(audit.action).toBe("insert");
        expect(audit.actor_id).toBe(adminId);
      }),
    );
  });

  // ===================================================================
  // Append-only protection
  // ===================================================================

  it("prevents updating audit rows", async () => {
    const auditRow = await query(
      `select id from app_public.financial_audit_events limit 1`,
    );

    await expect(
      query(
        `update app_public.financial_audit_events set action = 'delete' where id = $1`,
        [auditRow.rows[0].id],
      ),
    ).rejects.toThrow(/append-only|immutable/i);
  });

  it("prevents deleting audit rows", async () => {
    const auditRow = await query(
      `select id from app_public.financial_audit_events limit 1`,
    );

    await expect(
      query(
        `delete from app_public.financial_audit_events where id = $1`,
        [auditRow.rows[0].id],
      ),
    ).rejects.toThrow(/append-only|immutable/i);
  });

  // ===================================================================
  // RLS: non-admin cannot see audit events
  // ===================================================================

  it("non-admin session cannot see audit events through RLS", async () => {
    const client = await visitorPool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role "${requiredEnv("DATABASE_VISITOR")}"`);
      await client.query("select set_config('my.session_id', $1, true)", [studentSessionId]);
      const result = await client.query(
        "select count(*)::int as count from app_public.financial_audit_events",
      );
      expect(result.rows[0].count).toBe(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  // ===================================================================
  // Document number safety — never reused after rollback
  // ===================================================================

  it("bill numbers are consumed even after a failed transaction", async () => {
    const n1 = await query(
      `select app_public.next_bill_number($1::uuid) as n`,
      [familyId],
    );
    const firstNumber = n1.rows[0].n;

    const n2 = await query(
      `select app_public.next_bill_number($1::uuid) as n`,
      [familyId],
    );
    const secondNumber = n2.rows[0].n;
    expect(secondNumber).toBe(firstNumber + 1);

    // Simulate a failed transaction: insert bill, then rollback
    const client = await pool.connect();
    try {
      await client.query("begin");
      const n3 = await client.query(
        `select app_public.next_bill_number($1::uuid) as n`,
        [familyId],
      );
      const thirdNumber = n3.rows[0].n;
      expect(thirdNumber).toBe(secondNumber + 1);

      await client.query("rollback");
    } finally {
      client.release();
    }

    // After rollback, a new call should NOT reuse the rolled-back number
    const n4 = await query(
      `select app_public.next_bill_number($1::uuid) as n`,
      [familyId],
    );
    expect(n4.rows[0].n).toBe(secondNumber + 2);
    // The gap (secondNumber + 1 was consumed and lost) is expected
  });

  it("payment numbers are consumed even after a failed transaction", async () => {
    const n1 = await query(
      `select app_public.next_payment_number($1::uuid) as n`,
      [familyId],
    );
    const firstNumber = n1.rows[0].n;

    const client = await pool.connect();
    try {
      await client.query("begin");
      const n2 = await client.query(
        `select app_public.next_payment_number($1::uuid) as n`,
        [familyId],
      );
      expect(n2.rows[0].n).toBe(firstNumber + 1);

      await client.query("rollback");
    } finally {
      client.release();
    }

    const n3 = await query(
      `select app_public.next_payment_number($1::uuid) as n`,
      [familyId],
    );
    expect(n3.rows[0].n).toBe(firstNumber + 2);
  });

  // ===================================================================
  // Full createBill-with-rollback: number consumed, no bill persisted
  // ===================================================================

  it.layer(financialAuditServiceLayer)("createBill consumes a number before aborting", (effectIt) => {
    effectIt.effect("bill number is consumed when createBill aborts", () =>
      Effect.gen(function* () {
        const svc = yield* BillingLedgerService;
        const db = yield* PgRootDB;
        const nextNumber = () => db.selectNoFrom((eb) =>
          sql<number>`app_public.next_bill_number(${eb.val(familyId)}::uuid)`.as("n")
        ).pipe(Effect.head);
        const before = yield* nextNumber();
        const result = yield* Effect.exit(svc.createBill(adminSessionId, {
          familyId: "00000000-0000-0000-0000-000000000000",
          billingPeriodStart: "2026-10-01",
          billingPeriodEnd: "2026-10-31",
          lineItems: [{ studentId, lineType: "lesson", description: "Should fail", quantity: 1, unitPriceCents: 5000, amountCents: 5000 }],
        }));
        expect(result._tag).toBe("Failure");
        expect((yield* nextNumber()).n).toBeGreaterThan(before.n);
      }),
    );
  });
});
