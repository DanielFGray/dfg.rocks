import { Effect } from "effect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Main } from "../../components/ui/Container.js";
import { Card } from "../../components/ui/Card.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { formatCents } from "../../components/billing/helpers.js";
import { Table, TableHead, Tr, Th, Td } from "../../components/ui/Table.js";

export const Route = createFileRoute("/_authed/billing/")({
  head: () => ({ meta: [{ title: "Billing | DFG Portal" }] }),
  component: BillingPage,
  pendingComponent: () => <Main className="text-muted">Loading...</Main>,
});

function BillingPage() {
  const { isAdmin } = useAuth();
  const {
    data: payers,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin", "billing", "payers"],
    queryFn: () => Effect.runPromise(api.payersAdmin.billingPayers()),
    enabled: isAdmin,
  });

  if (!isAdmin) return null;
  const summaries = payers ?? [];

  const totalOutstanding = summaries.reduce((s, p) => s + p.outstanding_cents, 0);
  const totalOverdue = summaries.reduce((s, p) => s + p.overdue_cents, 0);
  const totalCredit = summaries.reduce((s, p) => s + p.credit_balance_cents, 0);

  return (
    <Main>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-primary">Billing</h1>
        <p className="mt-1 text-sm text-muted">Payer accounts receivable</p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Outstanding</p>
            <p className="mt-1 text-2xl font-bold text-primary">{formatCents(totalOutstanding)}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-red-600 uppercase dark:text-red-400">
              Overdue
            </p>
            <p className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">
              {formatCents(totalOverdue)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Payer Credit</p>
            <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
              {formatCents(totalCredit)}
            </p>
          </div>
        </Card>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading payers...</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load billing data.
        </p>
      ) : summaries.length === 0 ? (
        <EmptyState message="No payers found." />
      ) : (
        <Table>
          <TableHead>
            <Th>Payer</Th>
            <Th>Pays for</Th>
            <Th>Bills</Th>
            <Th>Total Billed</Th>
            <Th>Total Paid</Th>
            <Th>Outstanding</Th>
            <Th>Overdue</Th>
            <Th>Credit</Th>
          </TableHead>
          <tbody>
            {summaries.map((p) => (
              <Tr key={p.payer_id} hover>
                <Td>
                  <Link
                    to="/billing/payers/$payerId"
                    params={{ payerId: p.payer_id }}
                    className="font-medium text-accent hover:underline"
                  >
                    {p.payer_name}
                  </Link>
                </Td>
                <Td className="text-muted">{p.students.map((s) => s.name).join(", ") || "—"}</Td>
                <Td className="text-muted">{p.bill_count}</Td>
                <Td>{formatCents(p.total_billed_cents)}</Td>
                <Td>{formatCents(p.total_paid_cents)}</Td>
                <Td className="font-medium">{formatCents(p.outstanding_cents)}</Td>
                <Td className="text-red-600 dark:text-red-400">
                  {p.overdue_cents > 0 ? formatCents(p.overdue_cents) : "—"}
                </Td>
                <Td className="text-green-600 dark:text-green-400">
                  {p.credit_balance_cents > 0 ? formatCents(p.credit_balance_cents) : "—"}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Main>
  );
}
