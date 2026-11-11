import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { BillingLedgerService } from "../services/billingLedgerService.js";
import { adaptAdminErrors } from "../httpApiErrors.js";
import { requireAdminSession } from "./raw.js";
import { serializePaymentResponse, serializeRefund } from "./billingResponses.js";

export const PaymentsAdminApiGroupLive = HttpApiBuilder.group(
  Contract,
  "paymentsAdmin",
  (handlers) =>
    handlers
      .handle(
        "recordPayment",
        Effect.fnUntraced(function* ({ request, payload }) {
          const auth = yield* requireAdminSession(request);
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.recordPayment(auth.session.id, {
              payerId: payload.payer_id,
              amountCents: payload.amount_cents,
              method: payload.method,
              reference: payload.reference,
              receivedAt: payload.received_at ? new Date(payload.received_at) : undefined,
              notes: payload.notes,
              allocations: payload.allocations.map(
                (a: { bill_id: string; amount_cents: number }) => ({
                  billId: a.bill_id,
                  amountCents: a.amount_cents,
                }),
              ),
            }),
          );
          return serializePaymentResponse(result);
        }, adaptAdminErrors),
      )
      .handle(
        "refundPayment",
        Effect.fnUntraced(function* ({ request, params, payload }) {
          const auth = yield* requireAdminSession(request);
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.processRefund(auth.session.id, {
              paymentId: params.id,
              amountCents: payload.amount_cents,
              reason: payload.reason,
            }),
          );
          return serializeRefund(result);
        }, adaptAdminErrors),
      ),
);
