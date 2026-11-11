import { useState } from "react";
import { Effect } from "effect";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type {
  PayerBillingDetail,
  Discount,
  TaxRate,
  BillDetailResponse,
} from "../../../shared/schemas.js";
import { Card } from "../ui/Card.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";
import { Tabs, TabList, Tab, TabPanel } from "../ui/Tabs.js";
import { Modal } from "../ui/Modal.js";
import { Input } from "../ui/Input.js";
import { Select } from "../ui/Select.js";
import { Textarea } from "../ui/Textarea.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { getErrorMessage } from "../../lib/errors.js";
import {
  formatCents,
  dateLabel,
  dateTimeLabel,
  billStatusBadge,
  statusLabel,
  paymentMethodOptions,
} from "./helpers.js";

export function PayerBillingDetailView({
  data,
  payerId,
  onRefresh,
}: {
  data: PayerBillingDetail;
  payerId: string;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<string | number>("bills");

  const { payer_name, balance, bills, payments, credits } = data;

  return (
    <div data-testid="payer-billing-detail">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-primary dark:text-primary-dark">{payer_name}</h1>
        <p className="mt-1 text-sm text-muted dark:text-muted-dark">Payer billing detail</p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase dark:text-muted-dark">
              Outstanding
            </p>
            <p className="mt-1 text-2xl font-bold text-primary dark:text-primary-dark">
              {formatCents(balance.outstanding_cents)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-red-600 uppercase dark:text-red-400">
              Overdue
            </p>
            <p className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">
              {formatCents(balance.overdue_cents)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-green-600 uppercase dark:text-green-400">
              Credit Balance
            </p>
            <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
              {formatCents(balance.credit_balance_cents)}
            </p>
          </div>
        </Card>
      </div>

      <Tabs selectedKey={tab} onSelectionChange={setTab}>
        <TabList>
          <Tab id="bills" data-testid="tab-bills">
            Bills
          </Tab>
          <Tab id="payments" data-testid="tab-payments">
            Payments
          </Tab>
          <Tab id="credits" data-testid="tab-credits">
            Credits
          </Tab>
          <Tab id="discounts" data-testid="tab-discounts">
            Discounts
          </Tab>
          <Tab id="tax" data-testid="tab-tax">
            Tax
          </Tab>
        </TabList>

        <TabPanel id="bills" className="mt-6">
          <BillsSection bills={bills} payerId={payerId} onRefresh={onRefresh} />
        </TabPanel>
        <TabPanel id="payments" className="mt-6">
          <PaymentsSection payments={payments} payerId={payerId} onRefresh={onRefresh} />
        </TabPanel>
        <TabPanel id="credits" className="mt-6">
          <CreditsSection credits={credits} payerId={payerId} bills={bills} onRefresh={onRefresh} />
        </TabPanel>
        <TabPanel id="discounts" className="mt-6">
          <DiscountsSection payerId={payerId} />
        </TabPanel>
        <TabPanel id="tax" className="mt-6">
          <TaxSection payerId={payerId} />
        </TabPanel>
      </Tabs>
    </div>
  );
}

/* ---- Bills section ---- */

function BillsSection({
  bills,
  payerId,
  onRefresh,
}: {
  bills: PayerBillingDetail["bills"];
  payerId: string;
  onRefresh: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-primary dark:text-primary-dark">Bills</h2>
        <Button
          variant="outline"
          className="shrink-0 px-3 py-1.5 text-xs"
          data-testid="create-bill"
          onClick={() => setCreateOpen(true)}
        >
          + Create bill
        </Button>
      </div>

      {bills.length === 0 ? (
        <EmptyState
          message="No bills for this payer."
          action={{ label: "Create bill", onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
              <tr>
                <th className="px-4 py-3 font-medium">Bill #</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Due</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => (
                <tr
                  key={bill.id}
                  className="border-t border-overlay/8 hover:bg-overlay/4 dark:border-overlay-dark/8 dark:hover:bg-overlay-dark/4"
                >
                  <td className="px-4 py-3 font-medium text-primary dark:text-primary-dark">
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() => setSelectedBillId(bill.id)}
                    >
                      #{bill.bill_number}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className={billStatusBadge(bill.status)}>{statusLabel(bill.status)}</span>
                  </td>
                  <td className="px-4 py-3 text-muted dark:text-muted-dark">
                    {dateLabel(bill.billing_period_start)} – {dateLabel(bill.billing_period_end)}
                  </td>
                  <td className="px-4 py-3">{bill.due_date ? dateLabel(bill.due_date) : "—"}</td>
                  <td className="px-4 py-3 font-medium">{formatCents(bill.total_cents)}</td>
                  <td className="px-4 py-3">
                    <BillActions
                      bill={bill}
                      onRefresh={onRefresh}
                      onView={() => setSelectedBillId(bill.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateBillModal
        payerId={payerId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={onRefresh}
      />

      {selectedBillId && (
        <BillDetailModal
          billId={selectedBillId}
          open={true}
          onClose={() => setSelectedBillId(null)}
          onRefresh={onRefresh}
        />
      )}
    </section>
  );
}

/* ---- Bill actions (inline in bills table row) ---- */

function BillActions({
  bill,
  onRefresh,
  onView,
}: {
  bill: PayerBillingDetail["bills"][number];
  onRefresh: () => void;
  onView: () => void;
}) {
  const [voidOpen, setVoidOpen] = useState(false);

  const issue = useMutation({
    mutationFn: () => Effect.runPromise(api.billsAdmin.issueBill({ params: { id: bill.id } })),
    onSuccess: onRefresh,
  });

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={onView}>
        View
      </Button>
      {bill.status === "draft" && (
        <>
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-xs"
            disabled={issue.isPending}
            onClick={() => issue.mutate()}
          >
            {issue.isPending ? "..." : "Issue"}
          </Button>
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-xs text-red-600 dark:text-red-400"
            onClick={() => setVoidOpen(true)}
          >
            Void
          </Button>
        </>
      )}
      <ConfirmDialog
        open={voidOpen}
        onConfirm={() => {
          setVoidOpen(false);
        }}
        onCancel={() => setVoidOpen(false)}
        title="Void bill?"
        message="Are you sure you want to void this bill?"
        confirmLabel="Void"
        variant="danger"
      />
    </div>
  );
}

/* ---- Void bill with reason modal ---- */

function VoidBillModal({
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
      Effect.runPromise(api.billsAdmin.voidBill({ params: { id: billId }, payload: { reason } })),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Void bill">
      <form
        data-testid="void-bill-form"
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

/* ---- Create Bill modal ---- */

function CreateBillModal({
  payerId,
  open,
  onClose,
  onSaved,
}: {
  payerId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.billsAdmin.createBill({
          payload: {
            payer_id: payerId,
            billing_period_start: periodStart,
            billing_period_end: periodEnd,
            due_date: dueDate || undefined,
            line_items: [
              {
                student_id: "",
                line_type: "fee",
                description: "Fee",
                quantity: 1,
                unit_price_cents: 0,
                amount_cents: 0,
              },
            ],
            notes: notes.trim() || undefined,
          },
        }),
      ),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Create bill">
      <form
        data-testid="create-bill-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm text-muted dark:text-muted-dark">
          This is a simplified bill creation form. Full line item management coming soon.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            id="bill-period-start"
            name="billing_period_start"
            label="Period start"
            type="date"
            required
            value={periodStart}
            onChange={setPeriodStart}
          />
          <Input
            id="bill-period-end"
            name="billing_period_end"
            label="Period end"
            type="date"
            required
            value={periodEnd}
            onChange={setPeriodEnd}
          />
          <Input
            id="bill-due-date"
            name="due_date"
            label="Due date"
            type="date"
            value={dueDate}
            onChange={setDueDate}
          />
        </div>
        <Textarea id="bill-notes" name="notes" label="Notes" value={notes} onChange={setNotes} />
        {save.error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {getErrorMessage(save.error)}
          </p>
        ) : null}
        <div className="mt-2 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || !periodStart || !periodEnd}>
            {save.isPending ? "Creating..." : "Create bill"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Payments section ---- */

function PaymentsSection({
  payments,
  payerId,
  onRefresh,
}: {
  payments: PayerBillingDetail["payments"];
  payerId: string;
  onRefresh: () => void;
}) {
  const [recordOpen, setRecordOpen] = useState(false);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-primary dark:text-primary-dark">Payments</h2>
        <Button
          variant="outline"
          className="shrink-0 px-3 py-1.5 text-xs"
          data-testid="record-payment"
          onClick={() => setRecordOpen(true)}
        >
          + Record payment
        </Button>
      </div>

      {payments.length === 0 ? (
        <EmptyState
          message="No payments recorded."
          action={{ label: "Record payment", onClick: () => setRecordOpen(true) }}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
              <tr>
                <th className="px-4 py-3 font-medium">Payment #</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-overlay/8 hover:bg-overlay/4 dark:border-overlay-dark/8 dark:hover:bg-overlay-dark/4"
                >
                  <td className="px-4 py-3 font-medium text-primary dark:text-primary-dark">
                    #{p.payment_number}
                  </td>
                  <td className="px-4 py-3">{formatCents(p.amount_cents)}</td>
                  <td className="px-4 py-3 capitalize">{p.method.replaceAll("_", " ")}</td>
                  <td className="px-4 py-3 text-muted dark:text-muted-dark">
                    {dateLabel(p.received_at)}
                  </td>
                  <td className="px-4 py-3 text-muted dark:text-muted-dark">
                    {p.reference || "—"}
                  </td>
                  <td className="px-4 py-3 text-muted dark:text-muted-dark">
                    {p.reference || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RecordPaymentModal
        payerId={payerId}
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        onSaved={onRefresh}
      />
    </section>
  );
}

/* ---- Record Payment modal ---- */

function RecordPaymentModal({
  payerId,
  open,
  onClose,
  onSaved,
}: {
  payerId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.paymentsAdmin.recordPayment({
          payload: {
            payer_id: payerId,
            amount_cents: Math.round(Number(amount) * 100),
            method: method as any,
            reference: reference.trim() || undefined,
            received_at: receivedAt || undefined,
            notes: notes.trim() || undefined,
            allocations: [],
          },
        }),
      ),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Record payment">
      <form
        data-testid="record-payment-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm text-muted dark:text-muted-dark">
          Payment without allocations will be recorded as unapplied credit.
        </p>
        <Input
          id="payment-amount"
          name="amount"
          label="Amount (USD)"
          type="number"
          required
          value={amount}
          onChange={setAmount}
        />
        <Select
          id="payment-method"
          name="method"
          label="Method"
          options={paymentMethodOptions}
          required
          value={method}
          onChange={setMethod}
        />
        <Input
          id="payment-reference"
          name="reference"
          label="Reference (check #, etc.)"
          value={reference}
          onChange={setReference}
        />
        <Input
          id="payment-received-at"
          name="received_at"
          label="Received date"
          type="date"
          value={receivedAt}
          onChange={setReceivedAt}
        />
        <Textarea id="payment-notes" name="notes" label="Notes" value={notes} onChange={setNotes} />
        {save.error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {getErrorMessage(save.error)}
          </p>
        ) : null}
        <div className="mt-2 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || !amount || Number(amount) <= 0}>
            {save.isPending ? "Recording..." : "Record payment"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Credits section ---- */

function CreditsSection({
  credits,
  payerId,
  bills,
  onRefresh,
}: {
  credits: PayerBillingDetail["credits"];
  payerId: string;
  bills: PayerBillingDetail["bills"];
  onRefresh: () => void;
}) {
  const [issueOpen, setIssueOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);

  const availableBills = bills.filter((b) => b.status === "issued");

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-primary dark:text-primary-dark">Credits</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="shrink-0 px-3 py-1.5 text-xs"
            data-testid="issue-credit"
            onClick={() => setIssueOpen(true)}
          >
            + Issue credit
          </Button>
          {availableBills.length > 0 && (
            <Button
              variant="outline"
              className="shrink-0 px-3 py-1.5 text-xs"
              data-testid="apply-credit"
              onClick={() => setApplyOpen(true)}
            >
              Apply credit
            </Button>
          )}
        </div>
      </div>

      {credits.length === 0 ? (
        <EmptyState
          message="No credits issued."
          action={{ label: "Issue credit", onClick: () => setIssueOpen(true) }}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
              <tr>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Issued</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {credits.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-overlay/8 hover:bg-overlay/4 dark:border-overlay-dark/8 dark:hover:bg-overlay-dark/4"
                >
                  <td className="px-4 py-3 font-medium">{formatCents(c.amount_cents)}</td>
                  <td className="px-4 py-3 text-muted dark:text-muted-dark">{c.reason}</td>
                  <td className="px-4 py-3 text-muted dark:text-muted-dark">
                    {dateLabel(c.created_at)}
                  </td>
                  <td className="px-4 py-3 text-muted dark:text-muted-dark">
                    {c.expires_at ? dateLabel(c.expires_at) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {c.consumed_at ? (
                      <span className="inline-flex rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
                        Consumed
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                        Active
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <IssueCreditModal
        payerId={payerId}
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        onSaved={onRefresh}
      />
      {applyOpen && (
        <ApplyCreditModal
          bills={availableBills}
          credits={credits.filter((c) => !c.consumed_at)}
          open={applyOpen}
          onClose={() => setApplyOpen(false)}
          onSaved={onRefresh}
        />
      )}
    </section>
  );
}

/* ---- Issue Credit modal ---- */

function IssueCreditModal({
  payerId,
  open,
  onClose,
  onSaved,
}: {
  payerId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const save = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.creditsAdmin.createCredit({
          payload: {
            payer_id: payerId,
            amount_cents: Math.round(Number(amount) * 100),
            reason,
            expires_at: expiresAt || undefined,
          },
        }),
      ),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Issue credit">
      <form
        data-testid="issue-credit-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Input
          id="credit-amount"
          name="amount"
          label="Amount (USD)"
          type="number"
          required
          value={amount}
          onChange={setAmount}
        />
        <Textarea
          id="credit-reason"
          name="reason"
          label="Reason (required)"
          required
          value={reason}
          onChange={setReason}
        />
        <Input
          id="credit-expires"
          name="expires_at"
          label="Expires (optional)"
          type="date"
          value={expiresAt}
          onChange={setExpiresAt}
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
          <Button
            type="submit"
            disabled={save.isPending || !amount || Number(amount) <= 0 || !reason.trim()}
          >
            {save.isPending ? "Issuing..." : "Issue credit"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Apply Credit modal ---- */

function ApplyCreditModal({
  bills,
  credits,
  open,
  onClose,
  onSaved,
}: {
  bills: PayerBillingDetail["bills"];
  credits: PayerBillingDetail["credits"];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [creditId, setCreditId] = useState(credits[0]?.id ?? "");
  const [billId, setBillId] = useState(bills[0]?.id ?? "");
  const [amount, setAmount] = useState("");

  const save = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.creditsAdmin.applyCredit({
          payload: {
            credit_id: creditId,
            bill_id: billId,
            amount_cents: Math.round(Number(amount) * 100),
          },
        }),
      ),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Apply credit to bill">
      <form
        data-testid="apply-credit-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {credits.length > 1 && (
          <Select
            id="apply-credit"
            name="credit_id"
            label="Credit"
            options={credits.map((c) => ({
              value: c.id,
              label: `${formatCents(c.amount_cents)} — ${c.reason}`,
            }))}
            required
            value={creditId}
            onChange={setCreditId}
          />
        )}
        {bills.length > 1 && (
          <Select
            id="apply-bill"
            name="bill_id"
            label="Bill"
            options={bills.map((b) => ({
              value: b.id,
              label: `#${b.bill_number} — ${formatCents(b.total_cents)}`,
            }))}
            required
            value={billId}
            onChange={setBillId}
          />
        )}
        <Input
          id="apply-amount"
          name="amount"
          label="Amount to apply (USD)"
          type="number"
          required
          value={amount}
          onChange={setAmount}
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
          <Button type="submit" disabled={save.isPending || !amount || Number(amount) <= 0}>
            {save.isPending ? "Applying..." : "Apply credit"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Discounts section ---- */

function DiscountsSection({ payerId }: { payerId: string }) {
  const {
    data: discounts,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin", "billing", "discounts", payerId],
    queryFn: () => Effect.runPromise(api.payersAdmin.payerDiscounts({ params: { payerId } })),
  });
  const [createOpen, setCreateOpen] = useState(false);

  const items = discounts ?? [];

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-primary dark:text-primary-dark">Discounts</h2>
          <p className="mt-1 text-sm text-muted dark:text-muted-dark">
            Payer-specific discount configurations.
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0 px-3 py-1.5 text-xs"
          data-testid="create-discount"
          onClick={() => setCreateOpen(true)}
        >
          + Add discount
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted dark:text-muted-dark">Loading discounts...</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load discounts.
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          message="No discounts configured."
          action={{ label: "Add discount", onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((d) => (
            <DiscountCard key={d.id} discount={d} payerId={payerId} onRefresh={refetch} />
          ))}
        </div>
      )}

      <DiscountFormModal
        payerId={payerId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => refetch()}
      />
    </section>
  );
}

function DiscountCard({
  discount,
  payerId,
  onRefresh,
}: {
  discount: Discount;
  payerId: string;
  onRefresh: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);

  const toggleActive = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.billingRatesAdmin.updateDiscount({
          params: { id: discount.id },
          payload: { is_active: !discount.is_active },
        }),
      ),
    onSuccess: onRefresh,
  });

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-primary dark:text-primary-dark">{discount.label}</p>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                discount.is_active
                  ? "bg-green-500/15 text-green-700 dark:text-green-300"
                  : "bg-overlay/10 text-muted dark:bg-overlay-dark/10 dark:text-muted-dark"
              }`}
            >
              {discount.is_active ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted dark:text-muted-dark">
            {discount.discount_type === "percentage"
              ? `${discount.discount_value}%`
              : formatCents(discount.discount_value)}{" "}
            &middot; Applies to {discount.applies_to.replaceAll("_", " ")}
          </p>
          <p className="mt-0.5 text-xs text-muted dark:text-muted-dark">
            {dateLabel(discount.effective_from)}
            {discount.effective_until ? ` — ${dateLabel(discount.effective_until)}` : " onward"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={() => toggleActive.mutate()}
            disabled={toggleActive.isPending}
          >
            {discount.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
        </div>
      </div>
      {editOpen && (
        <DiscountFormModal
          payerId={payerId}
          discount={discount}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={onRefresh}
        />
      )}
    </Card>
  );
}

function DiscountFormModal({
  payerId,
  discount,
  open,
  onClose,
  onSaved,
}: {
  payerId: string;
  discount?: Discount;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(discount?.label ?? "");
  const [discountType, setDiscountType] = useState(discount?.discount_type ?? "percentage");
  const [discountValue, setDiscountValue] = useState(
    discount ? String(discount.discount_value) : "",
  );
  const [appliesTo, setAppliesTo] = useState(discount?.applies_to ?? "tuition");
  const [effectiveFrom, setEffectiveFrom] = useState(discount?.effective_from?.slice(0, 10) ?? "");
  const [effectiveUntil, setEffectiveUntil] = useState(
    discount?.effective_until?.slice(0, 10) ?? "",
  );

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, any> = {
        label,
        discount_type: discountType as any,
        discount_value:
          discountType === "percentage"
            ? Math.round(Number(discountValue) * 100) / 100
            : Math.round(Number(discountValue) * 100),
        applies_to: appliesTo as any,
        effective_from: effectiveFrom,
        ...(effectiveUntil ? { effective_until: effectiveUntil } : {}),
      };
      if (discount) {
        return Effect.runPromise(
          api.billingRatesAdmin.updateDiscount({ params: { id: discount.id }, payload }),
        );
      }
      return Effect.runPromise(
        api.billingRatesAdmin.createDiscount({
          // @ts-expect-error - spread type inference
          payload: { ...payload, payer_id: payerId },
        }),
      );
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={discount ? "Edit discount" : "Add discount"}>
      <form
        data-testid="discount-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Input
          id="discount-label"
          name="label"
          label="Label"
          required
          value={label}
          onChange={setLabel}
        />
        <Select
          id="discount-type"
          name="discount_type"
          label="Type"
          options={[
            { value: "percentage", label: "Percentage" },
            { value: "fixed", label: "Fixed amount" },
          ]}
          required
          value={discountType}
          onChange={(v) => setDiscountType(v as "percentage" | "fixed")}
        />
        <Input
          id="discount-value"
          name="discount_value"
          label={discountType === "percentage" ? "Value (%)" : "Value (USD)"}
          type="number"
          required
          value={discountValue}
          onChange={setDiscountValue}
        />
        <Select
          id="discount-applies-to"
          name="applies_to"
          label="Applies to"
          options={[
            { value: "all", label: "All charges" },
            { value: "tuition", label: "Tuition" },
            { value: "fees", label: "Fees" },
          ]}
          required
          value={appliesTo}
          onChange={(v) => setAppliesTo(v as any)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="discount-from"
            name="effective_from"
            label="Effective from"
            type="date"
            required
            value={effectiveFrom}
            onChange={setEffectiveFrom}
          />
          <Input
            id="discount-until"
            name="effective_until"
            label="Effective until (optional)"
            type="date"
            value={effectiveUntil}
            onChange={setEffectiveUntil}
          />
        </div>
        {save.error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {getErrorMessage(save.error)}
          </p>
        ) : null}
        <div className="mt-2 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={save.isPending || !label || !discountValue || Number(discountValue) <= 0}
          >
            {save.isPending ? "Saving..." : discount ? "Update discount" : "Create discount"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Tax section ---- */

function TaxSection({ payerId }: { payerId: string }) {
  const {
    data: exemptions,
    isLoading: exLoading,
    error: exError,
    refetch: refetchEx,
  } = useQuery({
    queryKey: ["admin", "billing", "tax-exemptions", payerId],
    queryFn: () => Effect.runPromise(api.payersAdmin.payerTaxExemptions({ params: { payerId } })),
  });

  const { data: taxRates } = useQuery({
    queryKey: ["admin", "billing", "tax-rates"],
    queryFn: () => Effect.runPromise(api.billingRatesAdmin.listTaxRates()),
  });

  const [createOpen, setCreateOpen] = useState(false);

  const items = exemptions ?? [];
  const rates = (taxRates ?? []) as TaxRate[];

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-primary dark:text-primary-dark">
            Tax Exemptions
          </h2>
          <p className="mt-1 text-sm text-muted dark:text-muted-dark">
            Tax rate exemptions for this payer.
          </p>
        </div>
        {rates.length > 0 && (
          <Button
            variant="outline"
            className="shrink-0 px-3 py-1.5 text-xs"
            data-testid="create-tax-exemption"
            onClick={() => setCreateOpen(true)}
          >
            + Add exemption
          </Button>
        )}
      </div>

      {exLoading ? (
        <p className="text-sm text-muted dark:text-muted-dark">Loading tax exemptions...</p>
      ) : exError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load tax exemptions.
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          message={
            rates.length === 0
              ? "No tax rates configured. Create tax rates first."
              : "No tax exemptions for this payer."
          }
          action={
            rates.length > 0
              ? { label: "Add exemption", onClick: () => setCreateOpen(true) }
              : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
              <tr>
                <th className="px-4 py-3 font-medium">Tax Rate</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Effective</th>
                <th className="px-4 py-3 font-medium">Expires</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ex) => {
                const rate = rates.find((r) => r.id === ex.tax_rate_id);
                return (
                  <tr
                    key={ex.id}
                    className="border-t border-overlay/8 hover:bg-overlay/4 dark:border-overlay-dark/8 dark:hover:bg-overlay-dark/4"
                  >
                    <td className="px-4 py-3 font-medium text-primary dark:text-primary-dark">
                      {rate?.label ?? ex.tax_rate_id} ({rate ? `${rate.rate_percent}%` : "?"})
                    </td>
                    <td className="px-4 py-3 text-muted dark:text-muted-dark">
                      {ex.exemption_reason}
                    </td>
                    <td className="px-4 py-3 text-muted dark:text-muted-dark">
                      {dateLabel(ex.effective_from)}
                    </td>
                    <td className="px-4 py-3 text-muted dark:text-muted-dark">
                      {ex.effective_until ? dateLabel(ex.effective_until) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TaxExemptionFormModal
        payerId={payerId}
        taxRates={rates}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => refetchEx()}
      />
    </section>
  );
}

function TaxExemptionFormModal({
  payerId,
  taxRates,
  open,
  onClose,
  onSaved,
}: {
  payerId: string;
  taxRates: TaxRate[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [taxRateId, setTaxRateId] = useState(taxRates[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveUntil, setEffectiveUntil] = useState("");

  const save = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.billingRatesAdmin.createTaxExemption({
          payload: {
            payer_id: payerId,
            tax_rate_id: taxRateId,
            exemption_reason: reason,
            effective_from: effectiveFrom,
            effective_until: effectiveUntil || undefined,
          },
        }),
      ),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Add tax exemption">
      <form
        data-testid="tax-exemption-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {taxRates.length > 1 ? (
          <Select
            id="exemption-tax-rate"
            name="tax_rate_id"
            label="Tax rate"
            options={taxRates.map((r) => ({
              value: r.id,
              label: `${r.label} (${r.rate_percent}%)`,
            }))}
            required
            value={taxRateId}
            onChange={setTaxRateId}
          />
        ) : (
          <input type="hidden" value={taxRateId} />
        )}
        <Textarea
          id="exemption-reason"
          name="reason"
          label="Exemption reason (required)"
          required
          value={reason}
          onChange={setReason}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id="exemption-from"
            name="effective_from"
            label="Effective from"
            type="date"
            required
            value={effectiveFrom}
            onChange={setEffectiveFrom}
          />
          <Input
            id="exemption-until"
            name="effective_until"
            label="Effective until (optional)"
            type="date"
            value={effectiveUntil}
            onChange={setEffectiveUntil}
          />
        </div>
        {save.error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {getErrorMessage(save.error)}
          </p>
        ) : null}
        <div className="mt-2 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || !reason.trim() || !effectiveFrom}>
            {save.isPending ? "Adding..." : "Add exemption"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Bill Detail Modal ---- */

function BillDetailModal({
  billId,
  open,
  onClose,
  onRefresh,
}: {
  billId: string;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "billing", "bill", billId],
    queryFn: () => Effect.runPromise(api.billsAdmin.getBill({ params: { id: billId } })),
    enabled: open,
  });

  const billData = data as BillDetailResponse | undefined;
  const [tab, setTab] = useState<string | number>("details");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Bill #${billData?.bill_number ?? billId}`}
      className="w-full max-w-3xl outline-hidden"
    >
      {isLoading ? (
        <p className="text-sm text-muted dark:text-muted-dark">Loading bill...</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load bill.
        </p>
      ) : billData ? (
        <BillDetailBody
          bill={billData}
          billId={billId}
          tab={tab}
          setTab={setTab}
          onRefresh={onRefresh}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
}

function BillDetailBody({
  bill,
  billId,
  tab,
  setTab,
  onRefresh,
  onClose,
}: {
  bill: BillDetailResponse;
  billId: string;
  tab: string | number;
  setTab: (t: string | number) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  return (
    <div data-testid="bill-detail">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className={billStatusBadge(bill.status)}>{statusLabel(bill.status)}</span>
        <span className="text-sm text-muted dark:text-muted-dark">
          Total: {formatCents(bill.total_cents)}
        </span>
        <span className="text-sm text-muted dark:text-muted-dark">
          Due: {bill.due_date ? dateLabel(bill.due_date) : "—"}
        </span>
      </div>

      <Tabs selectedKey={tab} onSelectionChange={setTab}>
        <TabList>
          <Tab id="details">Line Items</Tab>
          <Tab id="adjustments">Adjustments</Tab>
          <Tab id="credits">Credit Applications</Tab>
          <Tab id="actions">Actions</Tab>
        </TabList>

        <TabPanel id="details" className="mt-4">
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

        <TabPanel id="adjustments" className="mt-4">
          <div className="mb-4">
            <AdjustBillSection billId={billId} onSaved={onRefresh} />
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

        <TabPanel id="credits" className="mt-4">
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

        <TabPanel id="actions" className="mt-4">
          <BillActionsPanel bill={bill} onRefresh={onRefresh} onClose={onClose} />
        </TabPanel>
      </Tabs>
    </div>
  );
}

function AdjustBillSection({ billId, onSaved }: { billId: string; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.billsAdmin.adjustBill({
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
      className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-overlay/10 p-4 dark:border-overlay-dark/10"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Input
        id="adjust-amount"
        name="amount"
        label="Amount (USD, negative for discount)"
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

function BillActionsPanel({
  bill,
  onRefresh,
  onClose,
}: {
  bill: any;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [voidOpen, setVoidOpen] = useState(false);

  const issue = useMutation({
    mutationFn: () => Effect.runPromise(api.billsAdmin.issueBill({ params: { id: bill.id } })),
    onSuccess: () => {
      onRefresh();
      onClose();
    },
  });

  const cancel = useMutation({
    mutationFn: () => Effect.runPromise(api.billsAdmin.cancelBill({ params: { id: bill.id } })),
    onSuccess: () => {
      onRefresh();
      onClose();
    },
  });

  return (
    <div className="flex flex-col gap-3">
      {bill.status === "draft" && (
        <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
          {issue.isPending ? "Issuing..." : "Issue bill"}
        </Button>
      )}
      {(bill.status === "draft" || bill.status === "issued") && (
        <>
          <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            {cancel.isPending ? "Cancelling..." : "Cancel bill"}
          </Button>
          <Button variant="danger" onClick={() => setVoidOpen(true)} disabled={voidOpen}>
            Void bill
          </Button>
        </>
      )}

      <ConfirmDialog
        open={voidOpen}
        onCancel={() => setVoidOpen(false)}
        onConfirm={() => setVoidOpen(false)}
        title="Void bill?"
        message="Enter a reason for voiding this bill."
        confirmLabel="Open"
      />

      {voidOpen && (
        <VoidBillModal
          billId={bill.id}
          open={voidOpen}
          onClose={() => setVoidOpen(false)}
          onSaved={() => {}}
        />
      )}
    </div>
  );
}
