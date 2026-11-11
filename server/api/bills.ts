import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { HttpError } from "../pgErrors.js";
import { BillingLedgerService } from "../services/billingLedgerService.js";
import { adaptAdminErrors } from "../httpApiErrors.js";
import { serializeBillResponse, serializeAdjustment, mapBillDetail } from "./billingResponses.js";

export const BillsAdminApiGroupLive = HttpApiBuilder.group(Contract, "billsAdmin", (handlers) =>
  handlers
    .handle(
      "lessonBills",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
        const bills = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.listLessonBills(auth.session.id, query.month),
        );
        return bills;
      }, adaptAdminErrors),
    )
    .handle(
      "createBill",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const bill = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.createBill(auth.session.id, {
            payerId: payload.payer_id,
            billingPeriodStart: payload.billing_period_start,
            billingPeriodEnd: payload.billing_period_end,
            dueDate: payload.due_date,
            lineItems: payload.line_items.map(
              (li: {
                student_id: string;
                line_type: "lesson" | "single_booking" | "fee" | "adjustment" | "credit";
                description: string;
                quantity: number;
                unit_price_cents: number;
                amount_cents: number;
              }) => ({
                studentId: li.student_id,
                lineType: li.line_type,
                description: li.description,
                quantity: li.quantity,
                unitPriceCents: li.unit_price_cents,
                amountCents: li.amount_cents,
              }),
            ),
            notes: payload.notes,
          }),
        );
        const lineItems = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.billLineItems(auth.session.id, bill.id),
        );
        return {
          ...serializeBillResponse(bill),
          line_items: lineItems,
          adjustments: [],
          credit_applications: [],
        };
      }, adaptAdminErrors),
    )
    .handle(
      "getBill",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const result = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.getBill(auth.session.id, params.id),
        );
        if (!result) {
          return yield* new HttpError(404, "Bill not found");
        }
        return mapBillDetail(result, result);
      }, adaptAdminErrors),
    )
    .handle(
      "issueBill",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.issueBill(auth.session.id, params.id),
        );
        const result = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.getBill(auth.session.id, params.id),
        );
        if (!result) {
          return yield* new HttpError(404, "Bill not found");
        }
        return mapBillDetail(result, result);
      }, adaptAdminErrors),
    )
    .handle(
      "cancelBill",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.cancelBill(auth.session.id, params.id),
        );
        const result = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.getBill(auth.session.id, params.id),
        );
        if (!result) {
          return yield* new HttpError(404, "Bill not found");
        }
        return mapBillDetail(result, result);
      }, adaptAdminErrors),
    )
    .handle(
      "voidBill",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.voidBill(auth.session.id, {
            billId: params.id,
            reason: payload.reason,
          }),
        );
        const result = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.getBill(auth.session.id, params.id),
        );
        if (!result) {
          return yield* new HttpError(404, "Bill not found");
        }
        return mapBillDetail(result, result);
      }, adaptAdminErrors),
    )
    .handle(
      "adjustBill",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const result = yield* BillingLedgerService.use((billingLedgerService) =>
          billingLedgerService.createAdjustment(auth.session.id, {
            billId: params.id,
            amountCents: payload.amount_cents,
            reason: payload.reason,
          }),
        );
        return serializeAdjustment(result);
      }, adaptAdminErrors),
    ),
);
