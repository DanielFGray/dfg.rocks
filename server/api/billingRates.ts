import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { BillingLedgerService } from "../services/billingLedgerService.js";
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
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.createDiscount(auth.session.id, {
              payerId: payload.payer_id,
              label: payload.label,
              discountType: payload.discount_type,
              discountValue: payload.discount_value,
              appliesTo: payload.applies_to,
              effectiveFrom: payload.effective_from,
              effectiveUntil: payload.effective_until,
            }),
          );
          return serializeDiscount(result);
        }, adaptAdminErrors),
      )
      .handle(
        "updateDiscount",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.updateDiscount(auth.session.id, params.id, {
              label: payload.label,
              discountType: payload.discount_type,
              discountValue: payload.discount_value,
              appliesTo: payload.applies_to,
              effectiveFrom: payload.effective_from,
              effectiveUntil: payload.effective_until,
              isActive: payload.is_active,
            }),
          );
          return serializeDiscount(result);
        }, adaptAdminErrors),
      )
      .handle(
        "listTaxRates",
        Effect.fnUntraced(function* () {
          const auth = yield* CurrentSession;
          const rates = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.listTaxRates(auth.session.id),
          );
          return rates.map(serializeTaxRate);
        }, adaptAdminErrors),
      )
      .handle(
        "createTaxRate",
        Effect.fnUntraced(function* ({ payload }) {
          const auth = yield* CurrentSession;
          const result = yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.createTaxRate(auth.session.id, {
              label: payload.label,
              jurisdiction: payload.jurisdiction,
              ratePercent: payload.rate_percent,
              appliesTo: payload.applies_to,
              effectiveFrom: payload.effective_from,
              effectiveUntil: payload.effective_until,
            }),
          );
          return serializeTaxRate(result);
        }, adaptAdminErrors),
      )
      .handle(
        "createTaxExemption",
        Effect.fnUntraced(function* ({ payload }) {
          const auth = yield* CurrentSession;
          return yield* BillingLedgerService.use((billingLedgerService) =>
            billingLedgerService.createTaxExemption(auth.session.id, {
              payerId: payload.payer_id,
              taxRateId: payload.tax_rate_id,
              exemptionReason: payload.exemption_reason,
              effectiveFrom: payload.effective_from,
              effectiveUntil: payload.effective_until,
            }),
          );
        }, adaptAdminErrors),
      ),
);
