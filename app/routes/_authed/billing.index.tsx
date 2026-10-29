import { Effect } from "effect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import type { FamilyBillingSummary } from "../../../shared/schemas.js";
import { Main } from "../../components/ui/Container.js";
import { Card } from "../../components/ui/Card.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { formatCents } from "../../components/billing/helpers.js";

export const Route = createFileRoute("/_authed/billing/")({
  head: () => ({ meta: [{ title: "Billing | DFG Portal" }] }),
  component: BillingPage,
  pendingComponent: () => <Main className="text-muted dark:text-muted-dark">Loading...</Main>,
});

function BillingPage() {
  const { isAdmin } = useAuth();
  const {
    data: families,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin", "billing", "families"],
    queryFn: () => Effect.runPromise(api.admin.billingFamilies()),
    enabled: isAdmin,
  });

  if (!isAdmin) return null;
  const summaries = (families ?? []) as FamilyBillingSummary[];

  const totalOutstanding = summaries.reduce((s, f) => s + f.outstanding_cents, 0);
  const totalOverdue = summaries.reduce((s, f) => s + f.overdue_cents, 0);
  const totalCredit = summaries.reduce((s, f) => s + f.credit_balance_cents, 0);

  return (
    <Main>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-primary dark:text-primary-dark">Billing</h1>
        <p className="mt-1 text-sm text-muted dark:text-muted-dark">Family accounts receivable</p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase dark:text-muted-dark">
              Outstanding
            </p>
            <p className="mt-1 text-2xl font-bold text-primary dark:text-primary-dark">
              {formatCents(totalOutstanding)}
            </p>
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
            <p className="text-xs font-medium tracking-wide text-muted uppercase dark:text-muted-dark">
              Family Credit
            </p>
            <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
              {formatCents(totalCredit)}
            </p>
          </div>
        </Card>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted dark:text-muted-dark">Loading families...</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load billing data.
        </p>
      ) : summaries.length === 0 ? (
        <EmptyState message="No families found." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
              <tr>
                <th className="px-4 py-3 font-medium">Family</th>
                <th className="px-4 py-3 font-medium">Bills</th>
                <th className="px-4 py-3 font-medium">Total Billed</th>
                <th className="px-4 py-3 font-medium">Total Paid</th>
                <th className="px-4 py-3 font-medium">Outstanding</th>
                <th className="px-4 py-3 font-medium">Overdue</th>
                <th className="px-4 py-3 font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((f) => (
                <tr
                  key={f.family_id}
                  className="border-t border-overlay/8 hover:bg-overlay/4 dark:border-overlay-dark/8 dark:hover:bg-overlay-dark/4"
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/billing/families/$familyId"
                      params={{ familyId: f.family_id }}
                      className="font-medium text-accent hover:underline"
                    >
                      {f.family_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted dark:text-muted-dark">{f.bill_count}</td>
                  <td className="px-4 py-3">{formatCents(f.total_billed_cents)}</td>
                  <td className="px-4 py-3">{formatCents(f.total_paid_cents)}</td>
                  <td className="px-4 py-3 font-medium">{formatCents(f.outstanding_cents)}</td>
                  <td className="px-4 py-3 text-red-600 dark:text-red-400">
                    {f.overdue_cents > 0 ? formatCents(f.overdue_cents) : "—"}
                  </td>
                  <td className="px-4 py-3 text-green-600 dark:text-green-400">
                    {f.credit_balance_cents > 0 ? formatCents(f.credit_balance_cents) : "—"}
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
