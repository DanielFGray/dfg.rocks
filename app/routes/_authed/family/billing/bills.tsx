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

export const Route = createFileRoute("/_authed/family/billing/bills")({
  head: () => ({ meta: [{ title: "Bills | DFG Portal" }] }),
  component: BillsPage,
  pendingComponent: () => <Main className="text-muted dark:text-muted-dark">Loading...</Main>,
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
        <p className="text-sm text-muted dark:text-muted-dark">Loading bills...</p>
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
          className="text-sm text-muted hover:text-accent dark:text-muted-dark dark:hover:text-accent"
        >
          &larr; Back to billing
        </Link>
      </div>

      <h1 className="mb-6 text-2xl font-bold text-primary dark:text-primary-dark">All Bills</h1>

      {bills.length === 0 ? (
        <EmptyState message="No bills found." />
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
                <th className="px-4 py-3 font-medium">PDF</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill: any) => (
                <tr
                  key={bill.id}
                  className="border-t border-overlay/8 hover:bg-overlay/4 dark:border-overlay-dark/8 dark:hover:bg-overlay-dark/4"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to="/family/billing/bills/$billId"
                      params={{ billId: bill.id }}
                      className="text-accent hover:underline"
                    >
                      #{bill.bill_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={billStatusBadge(bill.status)}>
                      {statusLabel(bill.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted dark:text-muted-dark">
                    {dateLabel(bill.billing_period_start)} &ndash; {dateLabel(bill.billing_period_end)}
                  </td>
                  <td className="px-4 py-3">
                    {bill.due_date ? dateLabel(bill.due_date) : "\u2014"}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {formatCents(bill.total_cents)}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/api/family/billing/bills/${bill.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-accent hover:underline"
                    >
                      PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Main>
  );
}
