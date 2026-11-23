import { Effect } from "effect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api.js";
import { useAuth } from "../../../../lib/hooks/useAuth.js";
import { Main } from "../../../../components/ui/Container.js";
import { EmptyState } from "../../../../components/ui/EmptyState.js";
import {
  formatCents,
  dateLabel,
  billStatusBadge,
  statusLabel,
} from "../../../../components/billing/helpers.js";
import { Table, TableHead, Tr, Th, Td } from "../../../../components/ui/Table.js";

export const Route = createFileRoute("/_authed/family/billing/bills")({
  head: () => ({ meta: [{ title: "Bills | DFG Portal" }] }),
  component: BillsPage,
  pendingComponent: () => <Main className="text-muted">Loading...</Main>,
});

function BillsPage() {
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["family", "billing", "bills"],
    queryFn: () => Effect.runPromise(api.familyBilling.bills()),
    enabled: !!user && user.role !== "admin",
  });

  if (!user || user.role === "admin") return null;

  if (isLoading) {
    return (
      <Main>
        <p className="text-sm text-muted">Loading bills...</p>
      </Main>
    );
  }

  if (error) {
    return (
      <Main>
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load bills.
        </p>
      </Main>
    );
  }

  const bills = data ?? [];

  return (
    <Main>
      <div className="mb-6">
        <Link
          to="/family/billing"
          className="text-sm text-muted hover:text-accent dark:hover:text-accent"
        >
          &larr; Back to billing
        </Link>
      </div>

      <h1 className="mb-6 text-2xl font-bold text-primary">All Bills</h1>

      {bills.length === 0 ? (
        <EmptyState message="No bills found." />
      ) : (
        <Table>
          <TableHead>
            <Th>Bill #</Th>
            <Th>Status</Th>
            <Th>Period</Th>
            <Th>Due</Th>
            <Th>Total</Th>
            <Th>PDF</Th>
          </TableHead>
          <tbody>
            {bills.map((bill: any) => (
              <Tr key={bill.id} hover>
                <Td className="font-medium">
                  <Link
                    to="/family/billing/bills/$billId"
                    params={{ billId: bill.id }}
                    className="text-accent hover:underline"
                  >
                    #{bill.bill_number}
                  </Link>
                </Td>
                <Td>
                  <span className={billStatusBadge(bill.status)}>{statusLabel(bill.status)}</span>
                </Td>
                <Td className="text-muted">
                  {dateLabel(bill.billing_period_start)} &ndash;{" "}
                  {dateLabel(bill.billing_period_end)}
                </Td>
                <Td>{bill.due_date ? dateLabel(bill.due_date) : "\u2014"}</Td>
                <Td className="font-medium">{formatCents(bill.total_cents)}</Td>
                <Td>
                  <a
                    href={`/api/family/billing/bills/${bill.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-accent hover:underline"
                  >
                    PDF
                  </a>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Main>
  );
}
