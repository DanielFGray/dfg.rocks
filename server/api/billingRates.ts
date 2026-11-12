import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { BillingLedger } from "../services/billingLedger.js";
import { adaptAdminErrors } from "../httpApiErrors.js";
import { serializeDiscount, serializeTaxRate } from "./billingResponses.js";

export const BillingRatesAdminApiGroupLive = HttpApiBuilder.group(
  Contract,
  "billingRatesAdmin",
  (handlers) =>
    handlers
      .handle(
        "createDiscount",
        Effect.fnUntraced(function* ({ payload }) {
          const auth = yield* CurrentSession;
          const result = yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService
              .createDiscount({
                payerId: payload.payer_id,
                label: payload.label,
                discountType: payload.discount_type,
                discountValue: payload.discount_value,
                appliesTo: payload.applies_to,
                effectiveFrom: payload.effective_from,
                effectiveUntil: payload.effective_until,
              })
              .pipe(withAuthContext(auth.session.id)),
          );
          return serializeDiscount(result);
        }, adaptAdminErrors),
      )
      .handle(
        "updateDiscount",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          const result = yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService
              .updateDiscount(params.id, {
                label: payload.label,
                discountType: payload.discount_type,
                discountValue: payload.discount_value,
                appliesTo: payload.applies_to,
                effectiveFrom: payload.effective_from,
                effectiveUntil: payload.effective_until,
                isActive: payload.is_active,
              })
              .pipe(withAuthContext(auth.session.id)),
          );
          return serializeDiscount(result);
        }, adaptAdminErrors),
      )
      .handle(
        "listTaxRates",
        Effect.fnUntraced(function* () {
          const auth = yield* CurrentSession;
          const rates = yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService.listTaxRates().pipe(withAuthContext(auth.session.id)),
          );
          return rates.map(serializeTaxRate);
        }, adaptAdminErrors),
      )
      .handle(
        "createTaxRate",
        Effect.fnUntraced(function* ({ payload }) {
          const auth = yield* CurrentSession;
          const result = yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService
              .createTaxRate({
                label: payload.label,
                jurisdiction: payload.jurisdiction,
                ratePercent: payload.rate_percent,
                appliesTo: payload.applies_to,
                effectiveFrom: payload.effective_from,
                effectiveUntil: payload.effective_until,
              })
              .pipe(withAuthContext(auth.session.id)),
          );
          return serializeTaxRate(result);
        }, adaptAdminErrors),
      )
      .handle(
        "createTaxExemption",
        Effect.fnUntraced(function* ({ payload }) {
          const auth = yield* CurrentSession;
          return yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService
              .createTaxExemption({
                payerId: payload.payer_id,
                taxRateId: payload.tax_rate_id,
                exemptionReason: payload.exemption_reason,
                effectiveFrom: payload.effective_from,
                effectiveUntil: payload.effective_until,
              })
              .pipe(withAuthContext(auth.session.id)),
          );
        }, adaptAdminErrors),
      ),
);
