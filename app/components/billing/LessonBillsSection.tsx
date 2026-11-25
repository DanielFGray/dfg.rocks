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
import { Table, TableHead, Tr, Th, Td } from "../ui/Table.js";

/**
 * The month's single-booking lesson bills and whether each is paid. "Record cash"
 * records a cash payment for exactly what is still owed, allocated to that bill.
 */
export function LessonBillsSection({ month }: { month: string }) {
  const [recording, setRecording] = useState<LessonBill | null>(null);

  const bills = useQuery({
    queryKey: ["admin", "lesson-bills", month],
    queryFn: () =>
      Effect.runPromise(api.billsAdmin.lessonBills({ query: { month: `${month}-01` } })),
    enabled: month !== "",
  });

  const recordCash = useMutation({
    mutationFn: (bill: LessonBill) =>
      Effect.runPromise(
        api.paymentsAdmin.recordPayment({
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
      <h2 className="text-lg font-semibold text-primary">Single lessons</h2>
      <p className="mt-1 mb-4 text-sm text-muted">
        Lessons billed one at a time, and whether each has been paid.
      </p>
      {bills.isLoading ? (
        <p className="text-sm text-muted">Loading lesson bills...</p>
      ) : bills.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load lesson bills.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState message="No single lessons were billed in this month." />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted" data-testid="lesson-unpaid-count">
            {unpaid === 0 ? "Every lesson is paid." : `${unpaid} of ${rows.length} not paid.`}
          </p>
          {recordCash.error ? (
            <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
              {getErrorMessage(recordCash.error)}
            </p>
          ) : null}
          <Table>
            <TableHead>
              <Th>Lesson</Th>
              <Th>Student</Th>
              <Th>Paid by</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th />
            </TableHead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.bill_id} data-testid="lesson-bill-row">
                  <Td className="text-muted">{dateTimeLabel(row.scheduled_at)}</Td>
                  <Td>
                    <Link
                      to="/people/$id"
                      params={{ id: row.student_id }}
                      className="font-medium text-accent hover:underline"
                    >
                      {row.student_name}
                    </Link>
                  </Td>
                  <Td>
                    <Link
                      to="/billing/payers/$payerId"
                      params={{ payerId: row.payer_id }}
                      className="text-accent hover:underline"
                    >
                      {row.payer_name}
                    </Link>
                  </Td>
                  <Td>{formatCents(row.total_cents)}</Td>
                  <Td>
                    {row.outstanding_cents === 0 ? (
                      <span className="font-medium text-green-600 dark:text-green-400">Paid</span>
                    ) : (
                      <span className="font-medium text-red-600 dark:text-red-400">
                        {row.outstanding_cents === row.total_cents
                          ? "Not paid"
                          : `${formatCents(row.outstanding_cents)} owed`}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    {row.outstanding_cents === 0 ? null : (
                      <Button onClick={() => setRecording(row)} disabled={recordCash.isPending}>
                        Record cash
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
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
        onConfirm={async () => {
          if (recording) await recordCash.mutateAsync(recording);
          setRecording(null);
        }}
        onCancel={() => setRecording(null)}
      />
    </section>
  );
}
