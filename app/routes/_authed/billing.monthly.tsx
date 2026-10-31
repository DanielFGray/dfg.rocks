import { useState } from "react";
import { Effect } from "effect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { MonthlyPaymentStatus } from "../../../shared/schemas.js";
import { Main } from "../../components/ui/Container.js";
import { Button } from "../../components/ui/Button.js";
import { Input } from "../../components/ui/Input.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { MonthlyPaymentModal } from "../../components/billing/MonthlyPaymentModal.js";
import { dateLabel, formatCents } from "../../components/billing/helpers.js";

export const Route = createFileRoute("/_authed/billing/monthly")({
  head: () => ({ meta: [{ title: "Monthly Payments | DFG Portal" }] }),
  component: MonthlyPaymentsPage,
});

function MonthlyPaymentsPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [recording, setRecording] = useState<MonthlyPaymentStatus | null>(null);

  const status = useQuery({
    queryKey: ["admin", "monthly-payment-status", month],
    queryFn: () =>
      Effect.runPromise(api.admin.monthlyPaymentStatus({ query: { month: `${month}-01` } })),
    enabled: month !== "",
  });

  const rows = status.data ?? [];
  const unpaid = rows.filter((row) => row.payment === null).length;

  return (
    <Main>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary dark:text-primary-dark">
            Monthly payments
          </h1>
          <p className="mt-1 text-sm text-muted dark:text-muted-dark">
            Students on a monthly prepaid weekly schedule, and whether they have paid.
          </p>
        </div>
        <Input
          id="monthly-payments-month"
          name="month"
          label="Month"
          type="month"
          value={month}
          onChange={setMonth}
          data-testid="monthly-payments-month"
        />
      </div>

      {status.isLoading ? (
        <p className="text-sm text-muted dark:text-muted-dark">Loading payments...</p>
      ) : status.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load payments.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState message="No students have a monthly prepaid schedule in this month." />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted dark:text-muted-dark" data-testid="unpaid-count">
            {unpaid === 0 ? "Everyone has paid." : `${unpaid} of ${rows.length} not paid.`}
          </p>
          <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
                <tr>
                  <th className="px-4 py-3 font-medium">Student</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Paid on</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.student_id}
                    data-testid="monthly-payment-row"
                    className="border-t border-overlay/8 dark:border-overlay-dark/8"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to="/students/$id"
                        params={{ id: row.student_id }}
                        className="font-medium text-accent hover:underline"
                      >
                        {row.student_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {row.payment ? (
                        <span className="font-medium text-green-600 dark:text-green-400">Paid</span>
                      ) : (
                        <span className="font-medium text-red-600 dark:text-red-400">Not paid</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.payment ? formatCents(row.payment.amount_cents) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted dark:text-muted-dark">
                      {row.payment ? dateLabel(row.payment.paid_at) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted dark:text-muted-dark">
                      {row.payment?.notes ?? ""}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.payment ? null : (
                        <Button onClick={() => setRecording(row)}>Record payment</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {recording ? (
        <MonthlyPaymentModal
          studentId={recording.student_id}
          studentName={recording.student_name}
          initialMonth={month}
          open
          onClose={() => setRecording(null)}
          onSaved={() => void status.refetch()}
        />
      ) : null}
    </Main>
  );
}
