import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Admin, Csrf, Session } from "./guards.js";
import { Schema as S } from "effect";
import { CreditApplication, AdminCredit } from "../schemas.js";
import { adminErrors } from "../httpApiErrors.js";

const CreateCreditPayload = S.Struct({
  payer_id: S.String,
  student_id: S.optional(S.String),
  amount_cents: S.Finite,
  reason: S.String.pipe(S.check(S.isMinLength(1))),
  expires_at: S.optional(S.DateFromString),
});

const ApplyCreditPayload = S.Struct({
  credit_id: S.String,
  bill_id: S.String,
  amount_cents: S.Finite,
});

export const creditsAdminGroup = HttpApiGroup.make("creditsAdmin")
  .add(
    HttpApiEndpoint.post("createCredit", "/billing/credits", {
      error: adminErrors,
      payload: CreateCreditPayload,
      success: AdminCredit,
    }),
  )
  .add(
    HttpApiEndpoint.post("applyCredit", "/billing/credits/apply", {
      error: adminErrors,
      payload: ApplyCreditPayload,
      success: CreditApplication,
    }),
  )
  .middleware(Csrf)
  .middleware(Admin)
  .middleware(Session)
  .prefix("/api/admin");
