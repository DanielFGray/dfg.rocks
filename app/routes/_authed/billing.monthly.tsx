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
import { LessonBillsSection } from "../../components/billing/LessonBillsSection.js";
import { dateLabel, formatCents } from "../../components/billing/helpers.js";
import { Table, TableHead, Tr, Th, Td } from "../../components/ui/Table.js";

export const Route = createFileRoute("/_authed/billing/monthly")({
  head: () => ({ meta: [{ title: "Payments | DFG Portal" }] }),
  component: MonthlyPaymentsPage,
});

function MonthlyPaymentsPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [recording, setRecording] = useState<MonthlyPaymentStatus | null>(null);

  const status = useQuery({
    queryKey: ["admin", "monthly-payment-status", month],
    queryFn: () =>
      Effect.runPromise(
        api.monthlyBillingAdmin.monthlyPaymentStatus({ query: { month: `${month}-01` } }),
      ),
    enabled: month !== "",
  });

  const rows = status.data ?? [];
  const unpaid = rows.filter((row) => row.payment === null).length;

  return (
    <Main>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">Payments</h1>
          <p className="mt-1 text-sm text-muted">
            Who has paid this month, for monthly schedules and for single lessons.
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

      <h2 className="mb-4 text-lg font-semibold text-primary">Monthly prepaid</h2>
      {status.isLoading ? (
        <p className="text-sm text-muted">Loading payments...</p>
      ) : status.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load payments.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState message="No students have a monthly prepaid schedule in this month." />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted" data-testid="unpaid-count">
            {unpaid === 0 ? "Everyone has paid." : `${unpaid} of ${rows.length} not paid.`}
          </p>
          <Table>
            <TableHead>
              <Th>Student</Th>
              <Th>Status</Th>
              <Th>Amount</Th>
              <Th>Paid on</Th>
              <Th>Notes</Th>
              <Th />
            </TableHead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.student_id} data-testid="monthly-payment-row">
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
                    {row.payment ? (
                      <span className="font-medium text-green-600 dark:text-green-400">Paid</span>
                    ) : (
                      <span className="font-medium text-red-600 dark:text-red-400">Not paid</span>
                    )}
                  </Td>
                  <Td>{row.payment ? formatCents(row.payment.amount_cents) : "—"}</Td>
                  <Td className="text-muted">
                    {row.payment ? dateLabel(row.payment.paid_at) : "—"}
                  </Td>
                  <Td className="text-muted">{row.payment?.notes ?? ""}</Td>
                  <Td className="text-right">
                    {row.payment ? null : (
                      <Button onClick={() => setRecording(row)}>Record payment</Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </>
      )}

      <LessonBillsSection month={month} />

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
