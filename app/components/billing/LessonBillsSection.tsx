import { useState } from "react";
import { Effect } from "effect";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { LessonBill } from "../../../shared/schemas.js";
import { Button } from "../ui/Button.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { EmptyState } from "../ui/EmptyState.js";
import { getErrorMessage } from "../../lib/errors.js";
import { dateTimeLabel, formatCents } from "./helpers.js";

/**
 * The month's single-booking lesson bills and whether each is paid. "Record cash"
 * records a cash payment for exactly what is still owed, allocated to that bill.
 */
export function LessonBillsSection({ month }: { month: string }) {
  const [recording, setRecording] = useState<LessonBill | null>(null);

  const bills = useQuery({
    queryKey: ["admin", "lesson-bills", month],
    queryFn: () => Effect.runPromise(api.admin.lessonBills({ query: { month: `${month}-01` } })),
    enabled: month !== "",
  });

  const recordCash = useMutation({
    mutationFn: (bill: LessonBill) =>
      Effect.runPromise(
        api.admin.recordPayment({
          payload: {
            payer_id: bill.payer_id,
            amount_cents: bill.outstanding_cents,
            method: "cash",
            allocations: [{ bill_id: bill.bill_id, amount_cents: bill.outstanding_cents }],
          },
        }),
      ),
    onSuccess: () => void bills.refetch(),
  });

  const rows = bills.data ?? [];
  const unpaid = rows.filter((row) => row.outstanding_cents > 0).length;

  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold text-primary dark:text-primary-dark">Single lessons</h2>
      <p className="mt-1 mb-4 text-sm text-muted dark:text-muted-dark">
        Lessons billed one at a time, and whether each has been paid.
      </p>
      {bills.isLoading ? (
        <p className="text-sm text-muted dark:text-muted-dark">Loading lesson bills...</p>
      ) : bills.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load lesson bills.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState message="No single lessons were billed in this month." />
      ) : (
        <>
          <p
            className="mb-3 text-sm text-muted dark:text-muted-dark"
            data-testid="lesson-unpaid-count"
          >
            {unpaid === 0 ? "Every lesson is paid." : `${unpaid} of ${rows.length} not paid.`}
          </p>
          {recordCash.error ? (
            <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
              {getErrorMessage(recordCash.error)}
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
                <tr>
                  <th className="px-4 py-3 font-medium">Lesson</th>
                  <th className="px-4 py-3 font-medium">Student</th>
                  <th className="px-4 py-3 font-medium">Paid by</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.bill_id}
                    data-testid="lesson-bill-row"
                    className="border-t border-overlay/8 dark:border-overlay-dark/8"
                  >
                    <td className="px-4 py-3 text-muted dark:text-muted-dark">
                      {dateTimeLabel(row.scheduled_at)}
                    </td>
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
                      <Link
                        to="/billing/payers/$payerId"
                        params={{ payerId: row.payer_id }}
                        className="text-accent hover:underline"
                      >
                        {row.payer_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{formatCents(row.total_cents)}</td>
                    <td className="px-4 py-3">
                      {row.outstanding_cents === 0 ? (
                        <span className="font-medium text-green-600 dark:text-green-400">Paid</span>
                      ) : (
                        <span className="font-medium text-red-600 dark:text-red-400">
                          {row.outstanding_cents === row.total_cents
                            ? "Not paid"
                            : `${formatCents(row.outstanding_cents)} owed`}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.outstanding_cents === 0 ? null : (
                        <Button onClick={() => setRecording(row)} disabled={recordCash.isPending}>
                          Record cash
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ConfirmDialog
        open={recording !== null}
        title="Record cash payment"
        message={
          recording
            ? `Record ${formatCents(recording.outstanding_cents)} in cash from ${recording.payer_name} for ${recording.student_name}'s lesson on ${dateTimeLabel(recording.scheduled_at)}?`
            : ""
        }
        confirmLabel="Record cash"
        onConfirm={() => {
          if (recording) recordCash.mutate(recording);
          setRecording(null);
        }}
        onCancel={() => setRecording(null)}
      />
    </section>
  );
}
