import { useEffect, useState, type FormEvent } from "react";
import { Effect } from "effect";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { getErrorMessage } from "../../lib/errors.js";
import { Button } from "../ui/Button.js";
import { Input } from "../ui/Input.js";
import { Modal } from "../ui/Modal.js";
import { Textarea } from "../ui/Textarea.js";

/**
 * Records a monthly prepaid payment for one student. Recording it also queues
 * generation of that month's lessons from the student's recurring schedule.
 */
export function MonthlyPaymentModal({
  studentId,
  studentName,
  initialMonth,
  open,
  onClose,
  onSaved,
}: {
  studentId: string;
  studentName?: string;
  /** Billing month as YYYY-MM; defaults to the current month. */
  initialMonth?: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [billingMonth, setBillingMonth] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    setBillingMonth(initialMonth ?? now.toISOString().slice(0, 7));
    setPaidAt(now.toISOString().slice(0, 16));
    setAmount("");
    setNotes("");
  }, [open, initialMonth]);

  const save = useMutation({
    mutationFn: () =>
      Effect.runPromise(
        api.admin.recordMonthlyPayment({
          params: { studentId },
          payload: {
            billing_month: `${billingMonth}-01`,
            amount_cents: Math.round(Number(amount) * 100),
            paid_at: new Date(paidAt).toISOString(),
            notes: notes.trim() || null,
          },
        }),
      ),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={studentName ? `Record payment: ${studentName}` : "Record monthly payment"}
    >
      <form data-testid="monthly-payment-form" className="flex flex-col gap-4" onSubmit={submit}>
        <p className="text-sm text-muted dark:text-muted-dark">
          Recording a payment also creates this month's lessons from the student's weekly schedule.
        </p>
        <Input
          id="payment-month"
          name="billing_month"
          label="Billing month"
          type="month"
          required
          value={billingMonth}
          onChange={setBillingMonth}
          data-testid="payment-billing-month"
        />
        <Input
          id="payment-amount"
          name="amount"
          label="Amount (USD)"
          type="number"
          required
          value={amount}
          onChange={setAmount}
          data-testid="payment-amount"
        />
        <Input
          id="payment-paid-at"
          name="paid_at"
          label="Paid at"
          type="datetime-local"
          required
          value={paidAt}
          onChange={setPaidAt}
          data-testid="payment-paid-at"
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
          <Button
            type="submit"
            disabled={save.isPending || !billingMonth || !paidAt || !amount || Number(amount) <= 0}
          >
            {save.isPending ? "Recording..." : "Record payment"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
