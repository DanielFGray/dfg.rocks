import { useState } from "react";
import { Effect } from "effect";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../lib/api.js";
import type { BillDetailResponse } from "../../../shared/schemas.js";
import { Card } from "../ui/Card.js";
import { Button } from "../ui/Button.js";
import { Input } from "../ui/Input.js";
import { Textarea } from "../ui/Textarea.js";
import { Tabs, TabList, Tab, TabPanel } from "../ui/Tabs.js";
import { Modal } from "../ui/Modal.js";
import { getErrorMessage } from "../../lib/errors.js";
import { formatCents, dateLabel, dateTimeLabel, billStatusBadge, statusLabel } from "./helpers.js";

export function BillDetailView({
  bill,
  onRefresh,
}: {
  bill: BillDetailResponse;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<string | number>("lineItems");
  const [voidOpen, setVoidOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const issue = useMutation({
    mutationFn: () => Effect.runPromise(api.admin.issueBill({ params: { id: bill.id } })),
    onSuccess: onRefresh,
  });

  const cancel = useMutation({
    mutationFn: () => Effect.runPromise(api.admin.cancelBill({ params: { id: bill.id } })),
    onSuccess: onRefresh,
  });

  return (
    <div data-testid="bill-detail">
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-primary dark:text-primary-dark">
              Bill #{bill.bill_number}
            </h1>
            <p className="mt-1 text-sm text-muted dark:text-muted-dark">
              <Link
                to="/billing/payers/$payerId"
                params={{ payerId: bill.payer_id }}
                className="text-accent hover:underline"
              >
                View payer billing
              </Link>
            </p>
          </div>
          <span className={billStatusBadge(bill.status)}>{statusLabel(bill.status)}</span>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase dark:text-muted-dark">
              Subtotal
            </p>
            <p className="mt-1 text-lg font-bold text-primary dark:text-primary-dark">
              {formatCents(bill.subtotal_cents)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase dark:text-muted-dark">
              Discount
            </p>
            <p className="mt-1 text-lg font-bold text-green-600 dark:text-green-400">
              {bill.discount_cents > 0 ? `-${formatCents(bill.discount_cents)}` : "—"}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase dark:text-muted-dark">
              Tax
            </p>
            <p className="mt-1 text-lg font-bold text-primary dark:text-primary-dark">
              {bill.tax_cents > 0 ? formatCents(bill.tax_cents) : "—"}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-primary uppercase dark:text-primary-dark">
              Total
            </p>
            <p className="mt-1 text-lg font-bold text-primary dark:text-primary-dark">
              {formatCents(bill.total_cents)}
            </p>
          </div>
        </Card>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {bill.notes ? (
          <p className="w-full text-sm text-muted dark:text-muted-dark">Notes: {bill.notes}</p>
        ) : null}
        {bill.issued_at && (
          <span className="text-xs text-muted dark:text-muted-dark">
            Issued: {dateTimeLabel(bill.issued_at)}
          </span>
        )}
        {bill.due_date && (
          <span className="text-xs text-muted dark:text-muted-dark">
            Due: {dateLabel(bill.due_date)}
          </span>
        )}
        {bill.paid_at && (
          <span className="text-xs text-green-600 dark:text-green-400">
            Paid: {dateTimeLabel(bill.paid_at)}
          </span>
        )}
      </div>

      <Tabs selectedKey={tab} onSelectionChange={setTab}>
        <TabList>
          <Tab id="lineItems">Line Items</Tab>
          <Tab id="adjustments">Adjustments</Tab>
          <Tab id="creditApps">Credit Applications</Tab>
          <Tab id="actions">Actions</Tab>
        </TabList>

        <TabPanel id="lineItems" className="mt-6">
          {bill.line_items.length === 0 ? (
            <p className="text-sm text-muted dark:text-muted-dark">No line items.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
                  <tr>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Qty</th>
                    <th className="px-4 py-3 font-medium">Unit Price</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.line_items.map((li) => (
                    <tr
                      key={li.id}
                      className="border-t border-overlay/8 dark:border-overlay-dark/8"
                    >
                      <td className="px-4 py-3 font-medium text-primary dark:text-primary-dark">
                        {li.description}
                      </td>
                      <td className="px-4 py-3 text-muted dark:text-muted-dark">
                        {statusLabel(li.line_type)}
                      </td>
                      <td className="px-4 py-3">{li.quantity}</td>
                      <td className="px-4 py-3">{formatCents(li.unit_price_cents)}</td>
                      <td className="px-4 py-3 font-medium">{formatCents(li.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-overlay/4 text-xs dark:bg-overlay-dark/4">
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right font-medium">
                      Subtotal
                    </td>
                    <td className="px-4 py-2 font-medium">{formatCents(bill.subtotal_cents)}</td>
                  </tr>
                  {bill.discount_cents > 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-2 text-right text-muted dark:text-muted-dark"
                      >
                        Discount
                      </td>
                      <td className="px-4 py-2 text-green-600 dark:text-green-400">
                        -{formatCents(bill.discount_cents)}
                      </td>
                    </tr>
                  )}
                  {bill.tax_cents > 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-2 text-right text-muted dark:text-muted-dark"
                      >
                        Tax
                      </td>
                      <td className="px-4 py-2">{formatCents(bill.tax_cents)}</td>
                    </tr>
                  )}
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-2 text-right font-semibold text-primary dark:text-primary-dark"
                    >
                      Total
                    </td>
                    <td className="px-4 py-2 font-bold text-primary dark:text-primary-dark">
                      {formatCents(bill.total_cents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </TabPanel>

        <TabPanel id="adjustments" className="mt-6">
          <div className="mb-4">
            <AdjustmentForm billId={bill.id} onSaved={onRefresh} />
          </div>
          {bill.adjustments.length === 0 ? (
            <p className="text-sm text-muted dark:text-muted-dark">No adjustments.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
                  <tr>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.adjustments.map((adj) => (
                    <tr
                      key={adj.id}
                      className="border-t border-overlay/8 dark:border-overlay-dark/8"
                    >
                      <td className="px-4 py-3 font-medium">
                        <span
                          className={
                            adj.amount_cents < 0
                              ? "text-red-600 dark:text-red-400"
                              : "text-green-600 dark:text-green-400"
                          }
                        >
                          {adj.amount_cents < 0 ? "-" : "+"}
                          {formatCents(Math.abs(adj.amount_cents))}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted dark:text-muted-dark">{adj.reason}</td>
                      <td className="px-4 py-3 text-muted dark:text-muted-dark">
                        {dateTimeLabel(adj.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabPanel>

        <TabPanel id="creditApps" className="mt-6">
          {bill.credit_applications.length === 0 ? (
            <p className="text-sm text-muted dark:text-muted-dark">No credit applications.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
                  <tr>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.credit_applications.map((ca) => (
                    <tr
                      key={ca.id}
                      className="border-t border-overlay/8 dark:border-overlay-dark/8"
                    >
                      <td className="px-4 py-3 font-medium text-green-600 dark:text-green-400">
                        -{formatCents(ca.amount_cents)}
                      </td>
                      <td className="px-4 py-3 text-muted dark:text-muted-dark">
                        {dateTimeLabel(ca.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabPanel>

        <TabPanel id="actions" className="mt-6">
          <div className="flex flex-col gap-3">
            {bill.status === "draft" && (
              <Button
                onClick={() => issue.mutate()}
                disabled={issue.isPending}
                data-testid="issue-bill"
              >
                {issue.isPending ? "Issuing..." : "Issue bill"}
              </Button>
            )}
            {(bill.status === "draft" || bill.status === "issued") && (
              <>
                <Button variant="outline" onClick={() => setAdjustOpen(true)} disabled={adjustOpen}>
                  Add adjustment
                </Button>
                <Button
                  variant="outline"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                >
                  {cancel.isPending ? "Cancelling..." : "Cancel bill"}
                </Button>
                <Button variant="danger" onClick={() => setVoidOpen(true)}>
                  Void bill
                </Button>
              </>
            )}
          </div>

          <AdjustModal
            billId={bill.id}
            open={adjustOpen}
            onClose={() => setAdjustOpen(false)}
            onSaved={onRefresh}
          />

          <VoidModal
            billId={bill.id}
            open={voidOpen}
            onClose={() => setVoidOpen(false)}
            onSaved={onRefresh}
          />
        </TabPanel>
      </Tabs>
    </div>
  );
}

/* ---- Adjustment form ---- */

function AdjustmentForm({ billId, onSaved }: { billId: string; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.admin.adjustBill({
          params: { id: billId },
          payload: {
            amount_cents: Math.round(Number(amount) * 100),
            reason,
          },
        }),
      ),
    onSuccess: () => {
      setAmount("");
      setReason("");
      onSaved();
    },
  });

  return (
    <form
      data-testid="adjust-bill-form"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-overlay/10 p-4 dark:border-overlay-dark/10"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Input
        id="adjust-amount"
        name="amount"
        label="Amount (USD, negative for credit)"
        type="number"
        required
        value={amount}
        onChange={setAmount}
      />
      <Input
        id="adjust-reason"
        name="reason"
        label="Reason (required)"
        required
        value={reason}
        onChange={setReason}
      />
      <Button type="submit" disabled={save.isPending || !amount || !reason.trim()}>
        {save.isPending ? "Adding..." : "Add adjustment"}
      </Button>
      {save.error ? (
        <p className="w-full text-sm text-red-600 dark:text-red-400">
          {getErrorMessage(save.error)}
        </p>
      ) : null}
    </form>
  );
}

/* ---- Adjustment modal ---- */

function AdjustModal({
  billId,
  open,
  onClose,
  onSaved,
}: {
  billId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.admin.adjustBill({
          params: { id: billId },
          payload: {
            amount_cents: Math.round(Number(amount) * 100),
            reason,
          },
        }),
      ),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Add adjustment">
      <form
        data-testid="adjust-bill-modal"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Input
          id="adj-amount"
          name="amount"
          label="Amount in USD (negative for credit)"
          type="number"
          required
          value={amount}
          onChange={setAmount}
        />
        <Textarea
          id="adj-reason"
          name="reason"
          label="Reason (required)"
          required
          value={reason}
          onChange={setReason}
        />
        {save.error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {getErrorMessage(save.error)}
          </p>
        ) : null}
        <div className="mt-2 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || !amount || !reason.trim()}>
            {save.isPending ? "Adding..." : "Add adjustment"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Void modal ---- */

function VoidModal({
  billId,
  open,
  onClose,
  onSaved,
}: {
  billId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: () =>
      Effect.runPromise(api.admin.voidBill({ params: { id: billId }, payload: { reason } })),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Void bill">
      <form
        data-testid="void-bill-modal"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Textarea
          id="void-reason"
          name="reason"
          label="Reason (required)"
          required
          value={reason}
          onChange={setReason}
        />
        {save.error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {getErrorMessage(save.error)}
          </p>
        ) : null}
        <div className="mt-2 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || !reason.trim()}>
            {save.isPending ? "Voiding..." : "Void bill"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
