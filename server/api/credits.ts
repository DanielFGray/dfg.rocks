import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { BillingLedgerService } from "../services/billingLedgerService.js";
import { adaptAdminErrors } from "../httpApiErrors.js";
import { requireAdminSession } from "./raw.js";
import { serializeCreditResponse, serializeCreditApplication } from "./billingResponses.js";

export const CreditsAdminApiGroupLive = HttpApiBuilder.group(Contract, "creditsAdmin", (handlers) =>
  handlers
    .handle(
      "createCredit",
      Effect.fnUntraced(function* ({ request, payload }) {
        const auth = yield* requireAdminSession(request);
        const result = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.issueCredit(auth.session.id, {
            payerId: payload.payer_id,
            studentId: payload.student_id,
            amountCents: payload.amount_cents,
            reason: payload.reason,
            expiresAt: payload.expires_at,
          }),
        );
        return serializeCreditResponse(result);
      }, adaptAdminErrors),
    )
    .handle(
      "applyCredit",
      Effect.fnUntraced(function* ({ request, payload }) {
        const auth = yield* requireAdminSession(request);
        const result = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.applyCredit(auth.session.id, {
            creditId: payload.credit_id,
            billId: payload.bill_id,
            amountCents: payload.amount_cents,
          }),
        );
        return serializeCreditApplication(result);
      }, adaptAdminErrors),
    ),
);
