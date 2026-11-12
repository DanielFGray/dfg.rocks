import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { HttpError } from "../pgErrors.js";
import { BillingLedger } from "../services/billingLedger.js";
import { adaptAdminErrors } from "../httpApiErrors.js";
import { serializeAdjustment, mapBillDetail } from "./billingResponses.js";

export const BillsAdminApiGroupLive = HttpApiBuilder.group(Contract, "billsAdmin", (handlers) =>
  handlers
    .handle(
      "lessonBills",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
        const bills = yield* BillingLedger.use((billingLedgerService) =>
          billingLedgerService.listLessonBills(query.month).pipe(withAuthContext(auth.session.id)),
        );
        return bills;
      }, adaptAdminErrors),
    )
    .handle(
      "createBill",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        return yield* Effect.gen(function* () {
          const bill = yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService.createBill({
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
          const lineItems = yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService.billLineItems(bill.id),
          );
          return {
            ...bill,
            line_items: lineItems,
            adjustments: [],
            credit_applications: [],
          };
        }).pipe(withAuthContext(auth.session.id));
      }, adaptAdminErrors),
    )
    .handle(
      "getBill",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const result = yield* BillingLedger.use((billingLedgerService) =>
          billingLedgerService.getBill(params.id).pipe(withAuthContext(auth.session.id)),
        );
        if (!result) {
          return yield* new HttpError({ status: 404, message: "Bill not found" });
        }
        return mapBillDetail(result, result);
      }, adaptAdminErrors),
    )
    .handle(
      "issueBill",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        return yield* Effect.gen(function* () {
          yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService.issueBill(params.id),
          );
          const result = yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService.getBill(params.id),
          );
          if (!result) {
            return yield* new HttpError({ status: 404, message: "Bill not found" });
          }
          return mapBillDetail(result, result);
        }).pipe(withAuthContext(auth.session.id));
      }, adaptAdminErrors),
    )
    .handle(
      "cancelBill",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        return yield* Effect.gen(function* () {
          yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService.cancelBill(params.id),
          );
          const result = yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService.getBill(params.id),
          );
          if (!result) {
            return yield* new HttpError({ status: 404, message: "Bill not found" });
          }
          return mapBillDetail(result, result);
        }).pipe(withAuthContext(auth.session.id));
      }, adaptAdminErrors),
    )
    .handle(
      "voidBill",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        return yield* Effect.gen(function* () {
          yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService.voidBill({
              billId: params.id,
              reason: payload.reason,
            }),
          );
          const result = yield* BillingLedger.use((billingLedgerService) =>
            billingLedgerService.getBill(params.id),
          );
          if (!result) {
            return yield* new HttpError({ status: 404, message: "Bill not found" });
          }
          return mapBillDetail(result, result);
        }).pipe(withAuthContext(auth.session.id));
      }, adaptAdminErrors),
    )
    .handle(
      "adjustBill",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const result = yield* BillingLedger.use((billingLedgerService) =>
          billingLedgerService
            .createAdjustment({
              billId: params.id,
              amountCents: payload.amount_cents,
              reason: payload.reason,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return serializeAdjustment(result);
      }, adaptAdminErrors),
    ),
);
