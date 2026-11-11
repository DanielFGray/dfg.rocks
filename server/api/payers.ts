import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { BillingLedgerService } from "../services/billingLedgerService.js";
import { adaptAdminErrors } from "../httpApiErrors.js";
import {
  serializeBillResponse,
  serializePaymentResponse,
  serializeCreditResponse,
  serializeDiscount,
  serializeTaxExemption,
} from "./billingResponses.js";

export const PayersAdminApiGroupLive = HttpApiBuilder.group(Contract, "payersAdmin", (handlers) =>
  handlers
    .handle(
      "billingPayers",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        const summaries = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.listPayers(auth.session.id),
        );
        const balances = yield* Effect.all(
          summaries.map((summary) =>
            BillingLedgerService.use((billingLedgerService) =>
              billingLedgerService.getPayerBalance(auth.session.id, summary.payer_id),
            ),
          ),
        );
        return summaries.map((summary, index) => ({
          ...summary,
          outstanding_cents: balances[index]?.outstandingCents ?? summary.outstanding_cents,
          overdue_cents: balances[index]?.overdueCents ?? summary.overdue_cents,
          credit_balance_cents: balances[index]?.creditBalanceCents ?? summary.credit_balance_cents,
        }));
      }, adaptAdminErrors),
    )
    .handle(
      "billingPayer",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const detail = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.getPayerBillingDetail(auth.session.id, params.payerId),
        );
        return {
          ...detail,
          bills: detail.bills.map(serializeBillResponse),
          payments: detail.payments.map(serializePaymentResponse),
          credits: detail.credits.map(serializeCreditResponse),
        };
      }, adaptAdminErrors),
    )
    .handle(
      "billingPayerBills",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const bills = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.listPayerBills(auth.session.id, params.payerId),
        );
        return bills.map(serializeBillResponse);
      }, adaptAdminErrors),
    )
    .handle(
      "billingPayerPayments",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const payments = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.listPayerPayments(auth.session.id, params.payerId),
        );
        return payments.map(serializePaymentResponse);
      }, adaptAdminErrors),
    )
    .handle(
      "billingPayerCredits",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const credits = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.listPayerCredits(auth.session.id, params.payerId),
        );
        return credits.map(serializeCreditResponse);
      }, adaptAdminErrors),
    )
    .handle(
      "payerDiscounts",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const discounts = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.listPayerDiscounts(auth.session.id, params.payerId),
        );
        return discounts.map(serializeDiscount);
      }, adaptAdminErrors),
    )
    .handle(
      "payerTaxExemptions",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const exemptions = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.listPayerTaxExemptions(auth.session.id, params.payerId),
        );
        return exemptions.map(serializeTaxExemption);
      }, adaptAdminErrors),
    ),
);
