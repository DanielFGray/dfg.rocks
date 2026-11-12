import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { BillingLedgerService } from "../services/billingLedgerService.js";
import { adaptAdminErrors } from "../httpApiErrors.js";
import { serializeCreditApplication } from "./billingResponses.js";

export const CreditsAdminApiGroupLive = HttpApiBuilder.group(Contract, "creditsAdmin", (handlers) =>
  handlers
    .handle(
      "createCredit",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const result = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService
            .issueCredit({
              payerId: payload.payer_id,
              studentId: payload.student_id,
              amountCents: payload.amount_cents,
              reason: payload.reason,
              expiresAt: payload.expires_at,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return result;
      }, adaptAdminErrors),
    )
    .handle(
      "applyCredit",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const result = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService
            .applyCredit({
              creditId: payload.credit_id,
              billId: payload.bill_id,
              amountCents: payload.amount_cents,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return serializeCreditApplication(result);
      }, adaptAdminErrors),
    ),
);
