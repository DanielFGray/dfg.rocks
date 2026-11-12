import { runPlatform, testClient } from "./framework.js";
import { it, expect, describe, beforeAll, afterAll } from "@effect/vitest";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpBody from "effect/http/HttpBody";
import * as Cookies from "effect/http/Cookies";
import { Effect, Option } from "effect";
import pg from "pg";

let testDb: pg.Pool;
let adminCookie: string;
let studentCookie: string;
let teacherCookie: string;
let payerId: string;
let otherPayerId: string;
let studentId: string;
let adminUserId: string;
let rt: ReturnType<typeof testClient>;

const TEST_ROOT_URL = "http://127.0.0.1:3000";

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

function makeTestRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  opts: { body?: unknown; cookie?: string; csrf?: boolean } = {},
): HttpClientRequest.HttpClientRequest {
  const headers: Record<string, string> = {};
  if (opts.csrf !== false) headers["X-Requested-With"] = "dfg";
  if (opts.cookie) headers["Cookie"] = `session=${opts.cookie}`;

  const url = `${TEST_ROOT_URL}${path}`;
  const body: HttpBody.HttpBody | undefined =
    opts.body !== undefined
      ? HttpBody.text(JSON.stringify(opts.body), "application/json")
      : undefined;

  return HttpClientRequest.make(method)(url, { headers, body });
}

function getCookie(res: HttpClientResponse.HttpClientResponse): string | null {
  return Option.getOrElse(Cookies.getValue(res.cookies, "session"), () => null);
}

async function req(
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  opts: { body?: unknown; cookie?: string; csrf?: boolean } = {},
): Promise<HttpClientResponse.HttpClientResponse> {
  return rt.request(makeTestRequest(method, path, opts));
}

async function resJson(res: HttpClientResponse.HttpClientResponse): Promise<any> {
  return rt.json(res);
}

describe("Admin Billing API", () => {
  beforeAll(async () => {
    const dbUrl = forceIpv4(requiredEnv("DATABASE_URL"));

    await runPlatform(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.makeDirectory("generated", { recursive: true });
      }),
    );

    testDb = new pg.Pool({ connectionString: dbUrl });

    // Create admin user
    const adminResult = await testDb.query(
      `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
      ["billing_api_admin", "Billing API Admin", "billing-api-admin@test.com", "admin123"],
    );
    adminUserId = adminResult.rows[0].id;
    await testDb.query(`update app_public.users set role = 'admin' where id = $1`, [adminUserId]);

    // Create teacher
    const teacherResult = await testDb.query(
      `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
      ["billing_teacher", "Billing Teacher", "billing_teacher@test.com", "teacher123"],
    );
    await testDb.query(`update app_public.users set role = 'teacher' where id = $1`, [
      teacherResult.rows[0].id,
    ]);

    // Create student
    const studentResult = await testDb.query(
      `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
      ["billing_student", "Billing Student", "billing_student@test.com", "student123"],
    );
    studentId = studentResult.rows[0].id;
    await testDb.query(`update app_public.users set role = 'student' where id = $1`, [studentId]);

    const createUser = async (username: string, name: string, role: string) => {
      const result = await testDb.query(
        `select * from app_private.really_create_user($1::citext, $2, null, true, $3::citext, $4)`,
        [username, name, `${username}@test.com`, `${username}123`],
      );
      await testDb.query(`update app_public.users set role = $1 where id = $2`, [
        role,
        result.rows[0].id,
      ]);
      return result.rows[0].id;
    };

    // The billing contact of the student's family pays for the student.
    payerId = await createUser("billing_parent", "Billing Parent", "parent");
    const familyResult = await testDb.query(
      `insert into app_public.families (slug, name) values ($1, $2) returning id`,
      ["billing-test-family", "Billing Test Family"],
    );
    await testDb.query(
      `insert into app_public.family_memberships (family_id, user_id, is_owner, is_billing_contact)
       values ($1, $2, true, true), ($1, $3, false, false)`,
      [familyResult.rows[0].id, payerId, studentId],
    );

    // A student with no family pays for themself, and shares no family with
    // anyone here, so only the admin select policy shows their ledger.
    otherPayerId = await createUser("billing_other_student", "Billing Other Student", "student");

    const { handleApiRequest } = await import("./apiHandler.js");

    const httpClient = HttpClient.make((request, url, _signal, _fiber) =>
      Effect.tryPromise({
        try: async () => {
          let body: globalThis.BodyInit | undefined = undefined;
          switch (request.body._tag) {
            case "Raw":
            case "Uint8Array":
              body = request.body.body as any;
              break;
            case "FormData":
              body = request.body.formData;
              break;
          }
          const headers = Object.fromEntries(
            Object.keys(request.headers).map((k) => [k, (request.headers as any)[k]]),
          );
          const res = await handleApiRequest(
            new Request(url, { method: request.method, headers, body }),
          );
          return HttpClientResponse.fromWeb(request, res);
        },
        catch: (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          }),
      }),
    );

    rt = testClient(httpClient);

    const adminLoginRes = await req("POST", "/api/login", {
      body: { id: "billing_api_admin", password: "admin123" },
    });
    adminCookie = getCookie(adminLoginRes)!;
    if (!adminCookie)
      throw new Error(
        `Admin login failed (${adminLoginRes.status}): ${await rt.text(adminLoginRes)}`,
      );

    const studentLoginRes = await req("POST", "/api/login", {
      body: { id: "billing_student", password: "student123" },
    });
    studentCookie = getCookie(studentLoginRes)!;

    const teacherLoginRes = await req("POST", "/api/login", {
      body: { id: "billing_teacher", password: "teacher123" },
    });
    teacherCookie = getCookie(teacherLoginRes)!;
  }, 120_000);

  afterAll(async () => {
    await rt?.dispose();
    await testDb?.end();
  }, 30_000);

  // ==================================================================
  // Payer A/R list/detail
  // ==================================================================

  it("billing payers list returns payers with their students and AR summaries", async () => {
    const res = await req("GET", "/api/admin/billing/payers", {
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    const body = await resJson(res);
    expect(Array.isArray(body)).toBe(true);
    const ourPayer = body.find((p: { payer_id: string }) => p.payer_id === payerId);
    expect(ourPayer).toBeTruthy();
    expect(ourPayer.payer_name).toBe("Billing Parent");
    expect(ourPayer.students).toEqual([{ id: studentId, name: "Billing Student" }]);
    expect(typeof ourPayer.outstanding_cents).toBe("number");
    expect(typeof ourPayer.credit_balance_cents).toBe("number");
    expect(ourPayer.bill_count).toBeGreaterThanOrEqual(0);
  });

  it("admin sees payers they share no family with and a non-member does not", async () => {
    const billFor = async (billPayerId: string) => {
      const res = await req("POST", "/api/admin/billing/bills", {
        cookie: adminCookie,
        body: {
          payer_id: billPayerId,
          billing_period_start: "2026-06-01",
          billing_period_end: "2026-06-30",
          line_items: [
            {
              student_id: studentId,
              line_type: "lesson",
              description: "Visibility check",
              quantity: 1,
              unit_price_cents: 1000,
              amount_cents: 1000,
            },
          ],
        },
      });
      expect(res.status).toBe(200);
      return (await resJson(res)).id;
    };
    const familyBillId = await billFor(payerId);
    const otherBillId = await billFor(otherPayerId);

    const res = await req("GET", "/api/admin/billing/payers", { cookie: adminCookie });
    expect(res.status).toBe(200);
    const body = await resJson(res);
    expect(body.some((p: { payer_id: string }) => p.payer_id === otherPayerId)).toBe(true);

    const detailRes = await req("GET", `/api/admin/billing/payers/${otherPayerId}`, {
      cookie: adminCookie,
    });
    expect(detailRes.status).toBe(200);
    const detail = await resJson(detailRes);
    expect(detail.bills.map((b: { id: string }) => b.id)).toContain(otherBillId);

    const session = await testDb.query(
      `insert into app_private.sessions (user_id) values ($1) returning id`,
      [studentId],
    );
    // Only the API login is a member of the visitor role, as in production.
    const client = new pg.Client({ connectionString: requiredEnv("AUTH_DATABASE_URL") });
    await client.connect();
    try {
      await client.query("begin");
      await client.query(
        `select set_config('role', $1, true), set_config('my.session_id', $2, true)`,
        [requiredEnv("DATABASE_VISITOR"), session.rows[0].id],
      );
      const visible = await client.query(`select id from app_public.bills`);
      const ids = visible.rows.map((r) => r.id);
      expect(ids).toContain(familyBillId);
      expect(ids).not.toContain(otherBillId);
    } finally {
      await client.query("rollback");
      await client.end();
    }
  });

  it("billing payer detail returns payer balance and records", async () => {
    const res = await req("GET", `/api/admin/billing/payers/${payerId}`, {
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    const body = await resJson(res);
    expect(body.payer_id).toBe(payerId);
    expect(body.payer_name).toBe("Billing Parent");
    expect(typeof body.balance.outstanding_cents).toBe("number");
    expect(Array.isArray(body.bills)).toBe(true);
    expect(Array.isArray(body.payments)).toBe(true);
    expect(Array.isArray(body.credits)).toBe(true);

    const missingRes = await req(
      "GET",
      "/api/admin/billing/payers/00000000-0000-0000-0000-000000000000",
      { cookie: adminCookie },
    );
    expect(missingRes.status).toBe(404);
    expect((await resJson(missingRes)).error).toBe("Payer not found");
  });

  // ==================================================================
  // Bill creation and issue
  // ==================================================================

  it("create, get, and issue a bill", async () => {
    const createRes = await req("POST", "/api/admin/billing/bills", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        billing_period_start: "2026-07-01",
        billing_period_end: "2026-07-31",
        due_date: "2026-07-15",
        line_items: [
          {
            student_id: studentId,
            line_type: "lesson",
            description: "Weekly lessons x4",
            quantity: 4,
            unit_price_cents: 4500,
            amount_cents: 18000,
          },
        ],
      },
    });
    expect(createRes.status).toBe(200);
    const bill = await resJson(createRes);
    expect(bill.status).toBe("draft");
    expect(bill.payer_id).toBe(payerId);
    expect(bill.total_cents).toBe(18000);
    expect(bill.due_date).toContain("2026-07-15");

    const getRes = await req("GET", `/api/admin/billing/bills/${bill.id}`, {
      cookie: adminCookie,
    });
    expect(getRes.status).toBe(200);
    const detail = await resJson(getRes);
    expect(detail.id).toBe(bill.id);
    expect(Array.isArray(detail.line_items)).toBe(true);
    expect(Array.isArray(detail.adjustments)).toBe(true);
    expect(Array.isArray(detail.credit_applications)).toBe(true);

    const issueRes = await req("POST", `/api/admin/billing/bills/${bill.id}/issue`, {
      cookie: adminCookie,
    });
    expect(issueRes.status).toBe(200);
    const issued = await resJson(issueRes);
    expect(issued.status).toBe("issued");
    expect(issued.issued_at).toBeTruthy();
  });

  it("prevents issuing an already-issued bill", async () => {
    const createRes = await req("POST", "/api/admin/billing/bills", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        billing_period_start: "2026-08-01",
        billing_period_end: "2026-08-31",
        line_items: [
          {
            student_id: studentId,
            line_type: "lesson",
            description: "Monthly lessons",
            quantity: 4,
            unit_price_cents: 4500,
            amount_cents: 18000,
          },
        ],
      },
    });
    const bill = await resJson(createRes);
    const issueRes = await req("POST", `/api/admin/billing/bills/${bill.id}/issue`, {
      cookie: adminCookie,
    });
    expect(issueRes.status).toBe(200);
    const secondIssue = await req("POST", `/api/admin/billing/bills/${bill.id}/issue`, {
      cookie: adminCookie,
    });
    expect(secondIssue.status).toBe(409);
  });

  // ==================================================================
  // Void bill
  // ==================================================================

  it("voids an issued bill with reason", async () => {
    const createRes = await req("POST", "/api/admin/billing/bills", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        billing_period_start: "2026-08-01",
        billing_period_end: "2026-08-31",
        line_items: [
          {
            student_id: studentId,
            line_type: "lesson",
            description: "Monthly lessons",
            quantity: 4,
            unit_price_cents: 4500,
            amount_cents: 18000,
          },
        ],
      },
    });
    const bill = await resJson(createRes);
    await req("POST", `/api/admin/billing/bills/${bill.id}/issue`, { cookie: adminCookie });

    const voidRes = await req("POST", `/api/admin/billing/bills/${bill.id}/void`, {
      cookie: adminCookie,
      body: { reason: "Billing error" },
    });
    expect(voidRes.status).toBe(200);
    const voided = await resJson(voidRes);
    expect(voided.status).toBe("void");
  });

  it("prevents voiding without reason", async () => {
    const createRes = await req("POST", "/api/admin/billing/bills", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        billing_period_start: "2026-08-01",
        billing_period_end: "2026-08-31",
        line_items: [
          {
            student_id: studentId,
            line_type: "lesson",
            description: "Monthly lessons",
            quantity: 4,
            unit_price_cents: 4500,
            amount_cents: 18000,
          },
        ],
      },
    });
    const bill = await resJson(createRes);
    await req("POST", `/api/admin/billing/bills/${bill.id}/issue`, { cookie: adminCookie });

    const voidRes = await req("POST", `/api/admin/billing/bills/${bill.id}/void`, {
      cookie: adminCookie,
      body: { reason: "" },
    });
    expect(voidRes.status).toBe(400);
  });

  // ==================================================================
  // Record payment
  // ==================================================================

  it("records a payment with allocation", async () => {
    const createRes = await req("POST", "/api/admin/billing/bills", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        billing_period_start: "2026-09-01",
        billing_period_end: "2026-09-30",
        line_items: [
          {
            student_id: studentId,
            line_type: "lesson",
            description: "Monthly lessons",
            quantity: 4,
            unit_price_cents: 4500,
            amount_cents: 18000,
          },
        ],
      },
    });
    const bill = await resJson(createRes);
    await req("POST", `/api/admin/billing/bills/${bill.id}/issue`, { cookie: adminCookie });

    const payRes = await req("POST", "/api/admin/billing/payments", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        amount_cents: 18000,
        method: "check",
        reference: "CK-1001",
        received_at: "2026-07-05T12:00:00.000Z",
        notes: "July payment",
        allocations: [{ bill_id: bill.id, amount_cents: 18000 }],
      },
    });
    expect(payRes.status).toBe(200);
    const payment = await resJson(payRes);
    expect(payment.amount_cents).toBe(18000);
    expect(payment.method).toBe("check");
    expect(payment.reference).toBe("CK-1001");
  });

  it("prevents future payment dates", async () => {
    const createRes = await req("POST", "/api/admin/billing/bills", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        billing_period_start: "2026-09-01",
        billing_period_end: "2026-09-30",
        line_items: [
          {
            student_id: studentId,
            line_type: "lesson",
            description: "Monthly lessons",
            quantity: 4,
            unit_price_cents: 4500,
            amount_cents: 18000,
          },
        ],
      },
    });
    const bill = await resJson(createRes);

    const payRes = await req("POST", "/api/admin/billing/payments", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        amount_cents: 18000,
        method: "cash",
        received_at: "2099-01-01T00:00:00.000Z",
        allocations: [{ bill_id: bill.id, amount_cents: 18000 }],
      },
    });
    expect(payRes.status).toBe(400);
    const body = await resJson(payRes);
    expect(body.error).toContain("future");
  });

  // ==================================================================
  // Adjustments
  // ==================================================================

  it("creates an adjustment on an issued bill", async () => {
    const createRes = await req("POST", "/api/admin/billing/bills", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        billing_period_start: "2026-10-01",
        billing_period_end: "2026-10-31",
        line_items: [
          {
            student_id: studentId,
            line_type: "lesson",
            description: "Monthly lessons",
            quantity: 4,
            unit_price_cents: 4500,
            amount_cents: 18000,
          },
        ],
      },
    });
    const bill = await resJson(createRes);
    await req("POST", `/api/admin/billing/bills/${bill.id}/issue`, { cookie: adminCookie });

    const adjRes = await req("POST", `/api/admin/billing/bills/${bill.id}/adjust`, {
      cookie: adminCookie,
      body: { amount_cents: -5000, reason: "Late payment discount" },
    });
    expect(adjRes.status).toBe(200);
    const adj = await resJson(adjRes);
    expect(adj.amount_cents).toBe(-5000);
    expect(adj.reason).toBe("Late payment discount");
  });

  it("prevents adjustment without reason", async () => {
    const createRes = await req("POST", "/api/admin/billing/bills", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        billing_period_start: "2026-10-01",
        billing_period_end: "2026-10-31",
        line_items: [
          {
            student_id: studentId,
            line_type: "lesson",
            description: "Monthly lessons",
            quantity: 4,
            unit_price_cents: 4500,
            amount_cents: 18000,
          },
        ],
      },
    });
    const bill = await resJson(createRes);
    await req("POST", `/api/admin/billing/bills/${bill.id}/issue`, { cookie: adminCookie });

    const adjRes = await req("POST", `/api/admin/billing/bills/${bill.id}/adjust`, {
      cookie: adminCookie,
      body: { amount_cents: -5000, reason: "" },
    });
    expect(adjRes.status).toBe(400);
  });

  // ==================================================================
  // Credits
  // ==================================================================

  it("issues a credit and lists payer credits", async () => {
    const creditRes = await req("POST", "/api/admin/billing/credits", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        amount_cents: 10000,
        reason: "Referral bonus",
        student_id: studentId,
      },
    });
    expect(creditRes.status).toBe(200);
    const credit = await resJson(creditRes);
    expect(credit.amount_cents).toBe(10000);
    expect(credit.reason).toBe("Referral bonus");

    const listRes = await req("GET", `/api/admin/billing/payers/${payerId}/credits`, {
      cookie: adminCookie,
    });
    expect(listRes.status).toBe(200);
    const credits = await resJson(listRes);
    expect(credits.length).toBeGreaterThanOrEqual(1);
    expect(credits.some((c: any) => c.id === credit.id)).toBe(true);
  });

  it("bill detail returns real adjustments and credit applications", async () => {
    const createRes = await req("POST", "/api/admin/billing/bills", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        billing_period_start: "2026-09-01",
        billing_period_end: "2026-09-30",
        due_date: "2026-09-15",
        line_items: [
          {
            student_id: studentId,
            line_type: "lesson",
            description: "Monthly lessons",
            quantity: 4,
            unit_price_cents: 4500,
            amount_cents: 18000,
          },
        ],
      },
    });
    const bill = await resJson(createRes);
    await req("POST", `/api/admin/billing/bills/${bill.id}/issue`, { cookie: adminCookie });

    const adjRes = await req("POST", `/api/admin/billing/bills/${bill.id}/adjust`, {
      cookie: adminCookie,
      body: { amount_cents: -5000, reason: "Late payment discount" },
    });
    expect(adjRes.status).toBe(200);
    const adj = await resJson(adjRes);

    const creditRes = await req("POST", "/api/admin/billing/credits", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        amount_cents: 20000,
        reason: "Loyalty bonus",
        student_id: studentId,
      },
    });
    expect(creditRes.status).toBe(200);
    const credit = await resJson(creditRes);

    const applyRes = await req("POST", "/api/admin/billing/credits/apply", {
      cookie: adminCookie,
      body: {
        credit_id: credit.id,
        bill_id: bill.id,
        amount_cents: 10000,
      },
    });
    expect(applyRes.status).toBe(200);
    const app = await resJson(applyRes);

    const getRes = await req("GET", `/api/admin/billing/bills/${bill.id}`, {
      cookie: adminCookie,
    });
    expect(getRes.status).toBe(200);
    const detail = await resJson(getRes);

    expect(Array.isArray(detail.adjustments)).toBe(true);
    expect(detail.adjustments.length).toBeGreaterThanOrEqual(1);
    expect(detail.adjustments.some((a: any) => a.id === adj.id)).toBe(true);
    expect(detail.adjustments.find((a: any) => a.id === adj.id).amount_cents).toBe(-5000);

    expect(Array.isArray(detail.credit_applications)).toBe(true);
    expect(detail.credit_applications.length).toBeGreaterThanOrEqual(1);
    expect(detail.credit_applications.some((c: any) => c.id === app.id)).toBe(true);
    expect(detail.credit_applications.find((c: any) => c.id === app.id).amount_cents).toBe(10000);
  });

  it("prevents credit without reason", async () => {
    const creditRes = await req("POST", "/api/admin/billing/credits", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        amount_cents: 5000,
        reason: "",
      },
    });
    expect(creditRes.status).toBe(400);
  });

  // ==================================================================
  // Refunds
  // ==================================================================

  it("processes a refund against a payment", async () => {
    const createRes = await req("POST", "/api/admin/billing/bills", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        billing_period_start: "2026-11-01",
        billing_period_end: "2026-11-30",
        line_items: [
          {
            student_id: studentId,
            line_type: "lesson",
            description: "Monthly lessons",
            quantity: 4,
            unit_price_cents: 4500,
            amount_cents: 18000,
          },
        ],
      },
    });
    const bill = await resJson(createRes);
    await req("POST", `/api/admin/billing/bills/${bill.id}/issue`, { cookie: adminCookie });

    const payRes = await req("POST", "/api/admin/billing/payments", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        amount_cents: 18000,
        method: "cash",
        received_at: "2026-07-05T12:00:00.000Z",
        allocations: [{ bill_id: bill.id, amount_cents: 18000 }],
      },
    });
    expect(payRes.status).toBe(200);
    const payment = await resJson(payRes);

    const refundRes = await req("POST", `/api/admin/billing/payments/${payment.id}/refund`, {
      cookie: adminCookie,
      body: { amount_cents: 5000, reason: "Overpayment correction" },
    });
    expect(refundRes.status).toBe(200);
    const refund = await resJson(refundRes);
    expect(refund.amount_cents).toBe(5000);
    expect(refund.reason).toBe("Overpayment correction");
  });

  it("prevents refund without reason", async () => {
    const createRes = await req("POST", "/api/admin/billing/bills", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        billing_period_start: "2026-11-01",
        billing_period_end: "2026-11-30",
        line_items: [
          {
            student_id: studentId,
            line_type: "lesson",
            description: "Monthly lessons",
            quantity: 4,
            unit_price_cents: 4500,
            amount_cents: 18000,
          },
        ],
      },
    });
    const bill = await resJson(createRes);
    await req("POST", `/api/admin/billing/bills/${bill.id}/issue`, { cookie: adminCookie });

    const payRes = await req("POST", "/api/admin/billing/payments", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        amount_cents: 1000,
        method: "cash",
        received_at: "2026-07-05T12:00:00.000Z",
        allocations: [{ bill_id: bill.id, amount_cents: 1000 }],
      },
    });
    expect(payRes.status).toBe(200);
    const payment = await resJson(payRes);

    const refundRes = await req("POST", `/api/admin/billing/payments/${payment.id}/refund`, {
      cookie: adminCookie,
      body: { amount_cents: 500, reason: "" },
    });
    expect(refundRes.status).toBe(400);
  });

  // ==================================================================
  // Discount and tax configuration
  // ==================================================================

  it("creates and lists payer discounts", async () => {
    const createRes = await req("POST", "/api/admin/billing/discounts", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        label: "Early payment discount",
        discount_type: "percentage",
        discount_value: 10,
        applies_to: "all",
        effective_from: "2026-01-01",
      },
    });
    expect(createRes.status).toBe(200);
    const discount = await resJson(createRes);
    expect(discount.label).toBe("Early payment discount");
    expect(discount.discount_value).toBe(10);

    const listRes = await req("GET", `/api/admin/billing/payers/${payerId}/discounts`, {
      cookie: adminCookie,
    });
    expect(listRes.status).toBe(200);
    const discounts = await resJson(listRes);
    expect(discounts.length).toBeGreaterThanOrEqual(1);
  });

  it("creates and lists tax rates with decimal precision", async () => {
    const createRes = await req("POST", "/api/admin/billing/tax-rates", {
      cookie: adminCookie,
      body: {
        label: "State sales tax",
        jurisdiction: "CA",
        rate_percent: 8.25,
        applies_to: "tuition",
        effective_from: "2026-01-01",
      },
    });
    expect(createRes.status).toBe(200);
    const rate = await resJson(createRes);
    expect(rate.rate_percent).toBe(8.25);

    const listRes = await req("GET", "/api/admin/billing/tax-rates", {
      cookie: adminCookie,
    });
    expect(listRes.status).toBe(200);
    const rates = await resJson(listRes);
    expect(rates.length).toBeGreaterThanOrEqual(1);
    const ourRate = rates.find((r: any) => r.id === rate.id);
    expect(ourRate).toBeTruthy();
    expect(ourRate.rate_percent).toBe(8.25);
  });

  it("validates tax rate bounds (0-30)", async () => {
    const belowRes = await req("POST", "/api/admin/billing/tax-rates", {
      cookie: adminCookie,
      body: {
        label: "Negative rate",
        jurisdiction: "XX",
        rate_percent: -1,
        applies_to: "all",
        effective_from: "2026-01-01",
      },
    });
    expect(belowRes.status).toBe(400);

    const aboveRes = await req("POST", "/api/admin/billing/tax-rates", {
      cookie: adminCookie,
      body: {
        label: "Too high rate",
        jurisdiction: "XX",
        rate_percent: 50,
        applies_to: "all",
        effective_from: "2026-01-01",
      },
    });
    expect(aboveRes.status).toBe(400);

    const decimalBoundRes = await req("POST", "/api/admin/billing/tax-rates", {
      cookie: adminCookie,
      body: {
        label: "Boundary decimal",
        jurisdiction: "XX",
        rate_percent: 30.01,
        applies_to: "all",
        effective_from: "2026-01-01",
      },
    });
    expect(decimalBoundRes.status).toBe(400);

    const validRes = await req("POST", "/api/admin/billing/tax-rates", {
      cookie: adminCookie,
      body: {
        label: "Valid boundary",
        jurisdiction: "XX",
        rate_percent: 30.0,
        applies_to: "all",
        effective_from: "2026-01-01",
      },
    });
    expect(validRes.status).toBe(200);
  });

  // ==================================================================
  // Authorization: teachers and students must not access billing
  // ==================================================================

  it("teacher cannot access billing endpoints", async () => {
    const res = await req("GET", "/api/admin/billing/payers", {
      cookie: teacherCookie,
    });
    expect(res.status).toBe(403);
  });

  it("student cannot access billing endpoints", async () => {
    const res = await req("GET", "/api/admin/billing/payers", {
      cookie: studentCookie,
    });
    expect(res.status).toBe(403);
  });

  it("unauthenticated cannot access billing endpoints", async () => {
    const res = await req("GET", "/api/admin/billing/payers");
    expect(res.status).toBe(401);
  });

  // ==================================================================
  // Cancel bill (draft)
  // ==================================================================

  it("cancels a draft bill", async () => {
    const createRes = await req("POST", "/api/admin/billing/bills", {
      cookie: adminCookie,
      body: {
        payer_id: payerId,
        billing_period_start: "2026-12-01",
        billing_period_end: "2026-12-31",
        line_items: [
          {
            student_id: studentId,
            line_type: "lesson",
            description: "Monthly lessons",
            quantity: 4,
            unit_price_cents: 4500,
            amount_cents: 18000,
          },
        ],
      },
    });
    const bill = await resJson(createRes);

    const cancelRes = await req("POST", `/api/admin/billing/bills/${bill.id}/cancel`, {
      cookie: adminCookie,
    });
    expect(cancelRes.status).toBe(200);
    const cancelled = await resJson(cancelRes);
    expect(cancelled.status).toBe("cancelled");
  });

  // ==================================================================
  // Payer bills list
  // ==================================================================

  it("lists bills for a payer", async () => {
    const res = await req("GET", `/api/admin/billing/payers/${payerId}/bills`, {
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    const bills = await resJson(res);
    expect(Array.isArray(bills)).toBe(true);
    expect(bills.length).toBeGreaterThanOrEqual(1);
  });

  // ==================================================================
  // Payer payments list
  // ==================================================================

  it("lists payments for a payer", async () => {
    const res = await req("GET", `/api/admin/billing/payers/${payerId}/payments`, {
      cookie: adminCookie,
    });
    expect(res.status).toBe(200);
    const payments = await resJson(res);
    expect(Array.isArray(payments)).toBe(true);
  });
});
