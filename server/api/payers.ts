import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { BillingLedgerService } from "../services/billingLedgerService.js";
import { adaptAdminErrors } from "../httpApiErrors.js";
import { serializeDiscount } from "./billingResponses.js";

export const PayersAdminApiGroupLive = HttpApiBuilder.group(Contract, "payersAdmin", (handlers) =>
  handlers
    .handle(
      "billingPayers",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        return yield* Effect.gen(function* () {
          const summaries = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.listPayers(),
          );
          const balances = yield* Effect.all(
            summaries.map((summary) =>
              BillingLedgerService.use((billingLedgerService) =>
                billingLedgerService.getPayerBalance(summary.payer_id),
              ),
            ),
          );
          return summaries.map((summary, index) => ({
            ...summary,
            outstanding_cents: balances[index]?.outstandingCents ?? summary.outstanding_cents,
            overdue_cents: balances[index]?.overdueCents ?? summary.overdue_cents,
            credit_balance_cents:
              balances[index]?.creditBalanceCents ?? summary.credit_balance_cents,
          }));
        }).pipe(withAuthContext(auth.session.id));
      }, adaptAdminErrors),
    )
    .handle(
      "billingPayer",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        return yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService
            .getPayerBillingDetail(params.payerId)
            .pipe(withAuthContext(auth.session.id)),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "billingPayerBills",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        return yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService
            .listPayerBills(params.payerId)
            .pipe(withAuthContext(auth.session.id)),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "billingPayerPayments",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const payments = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService
            .listPayerPayments(params.payerId)
            .pipe(withAuthContext(auth.session.id)),
        );
        return payments;
      }, adaptAdminErrors),
    )
    .handle(
      "billingPayerCredits",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const credits = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService
            .listPayerCredits(params.payerId)
            .pipe(withAuthContext(auth.session.id)),
        );
        return credits;
      }, adaptAdminErrors),
    )
    .handle(
      "payerDiscounts",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const discounts = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService
            .listPayerDiscounts(params.payerId)
            .pipe(withAuthContext(auth.session.id)),
        );
        return discounts.map(serializeDiscount);
      }, adaptAdminErrors),
    )
    .handle(
      "payerTaxExemptions",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        return yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService
            .listPayerTaxExemptions(params.payerId)
            .pipe(withAuthContext(auth.session.id)),
        );
      }, adaptAdminErrors),
    ),
);
