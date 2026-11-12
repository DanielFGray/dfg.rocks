import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { BillingLedger } from "../services/billingLedger.js";
import { adaptAdminErrors } from "../httpApiErrors.js";
import { serializeRefund } from "./billingResponses.js";

export const PaymentsAdminApiGroupLive = HttpApiBuilder.group(
  Contract,
  "paymentsAdmin",
  (handlers) =>
    handlers
      .handle(
        "recordPayment",
        Effect.fnUntraced(function* ({ payload }) {
          const auth = yield* CurrentSession;
          const result = yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService
              .recordPayment({
                payerId: payload.payer_id,
                amountCents: payload.amount_cents,
                method: payload.method,
                reference: payload.reference,
                receivedAt: payload.received_at,
                notes: payload.notes,
                allocations: payload.allocations.map(
                  (a: { bill_id: string; amount_cents: number }) => ({
                    billId: a.bill_id,
                    amountCents: a.amount_cents,
                  }),
                ),
              })
              .pipe(withAuthContext(auth.session.id)),
          );
          return result;
        }, adaptAdminErrors),
      )
      .handle(
        "refundPayment",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          const result = yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService
              .processRefund({
                paymentId: params.id,
                amountCents: payload.amount_cents,
                reason: payload.reason,
              })
              .pipe(withAuthContext(auth.session.id)),
          );
          return serializeRefund(result);
        }, adaptAdminErrors),
      ),
);
