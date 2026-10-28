import { Effect } from "effect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api.js";
import { useAuth } from "../../../lib/hooks/useAuth.js";
import { Main } from "../../../components/ui/Container.js";
import { Card } from "../../../components/ui/Card.js";
import { EmptyState } from "../../../components/ui/EmptyState.js";
import {
  formatCents,
  dateLabel,
  billStatusBadge,
  statusLabel,
} from "../../../components/billing/helpers.js";

export const Route = createFileRoute("/_authed/family/billing/")({
  head: () => ({ meta: [{ title: "Billing | DFG Portal" }] }),
  component: FamilyBillingOverviewPage,
  pendingComponent: () => <Main className="text-muted dark:text-muted-dark">Loading...</Main>,
});

function FamilyBillingOverviewPage() {
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["family", "billing", "overview"],
    queryFn: () => Effect.runPromise(api.familyBilling.overview()),
    enabled: !!user && user.role !== "admin",
  });

  if (!user || user.role === "admin") return null;

  if (isLoading) {
    return (
      <Main>
        <p className="text-sm text-muted dark:text-muted-dark">Loading billing data...</p>
      </Main>
    );
  }

  if (error) {
    return (
      <Main>
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load billing data.
        </p>
      </Main>
    );
  }

  if (!data) return null;

  const { family_name, balance, open_bills, overdue_bills, recent_payments, credits } = data;

  return (
    <Main>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-primary dark:text-primary-dark">Billing</h1>
        <p className="mt-1 text-sm text-muted dark:text-muted-dark">{family_name}</p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted dark:text-muted-dark">
              Gross Outstanding
            </p>
            <p className="mt-1 text-2xl font-bold text-primary dark:text-primary-dark">
              {formatCents(balance.gross_outstanding_cents)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted dark:text-muted-dark">
              Available Credit
            </p>
            <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
              {formatCents(balance.available_credit_cents)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted dark:text-muted-dark">
              Net Due
            </p>
            <p className={`mt-1 text-2xl font-bold ${balance.net_due_cents > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
              {formatCents(balance.net_due_cents)}
            </p>
          </div>
        </Card>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted dark:text-muted-dark">
              Outstanding
            </p>
            <p className="mt-1 text-lg font-semibold text-primary dark:text-primary-dark">
              {formatCents(balance.outstanding_cents)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-red-600 dark:text-red-400">
              Overdue
            </p>
            <p className="mt-1 text-lg font-semibold text-red-600 dark:text-red-400">
              {balance.overdue_cents > 0 ? formatCents(balance.overdue_cents) : "\u2014"}
            </p>
          </div>
        </Card>
      </div>

      {/* Open Bills section */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-primary dark:text-primary-dark">
          Open Bills
        </h2>
        {open_bills.length === 0 ? (
          <EmptyState message="No open bills." />
        ) : (
          <BillTable bills={open_bills} />
        )}
      </section>

      {/* Overdue Bills section */}
      {overdue_bills.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-red-600 dark:text-red-400">
            Overdue Bills
          </h2>
          <BillTable bills={overdue_bills} />
        </section>
      )}

      {/* Recent Payments section */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-primary dark:text-primary-dark">
          Recent Payments
        </h2>
        {recent_payments.length === 0 ? (
          <EmptyState message="No payments recorded." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
                <tr>
                  <th className="px-4 py-3 font-medium">Payment #</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {recent_payments.map((p) => (
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
                    <td className="px-4 py-3">
                      <Link
                        to="/family/billing/payments/$paymentId"
                        params={{ paymentId: p.id }}
                        className="text-sm text-accent hover:underline"
                      >
                        View receipt
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4">
          <Link
            to="/family/billing/bills"
            className="text-sm text-accent hover:underline"
          >
            View all bills &rarr;
          </Link>
        </div>
      </section>

      {/* Credits section */}
      {credits.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-primary dark:text-primary-dark">
            Active Credits
          </h2>
          <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
                <tr>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Issued</th>
                  <th className="px-4 py-3 font-medium">Expires</th>
                </tr>
              </thead>
              <tbody>
                {credits.filter((c) => !c.consumed_at).map((c) => (
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
                      {c.expires_at ? dateLabel(c.expires_at) : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Main>
  );
}

function BillTable({ bills }: { bills: readonly any[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
      <table className="w-full text-left text-sm">
        <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
          <tr>
            <th className="px-4 py-3 font-medium">Bill #</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Period</th>
            <th className="px-4 py-3 font-medium">Due</th>
            <th className="px-4 py-3 font-medium">Total</th>
            <th className="px-4 py-3 font-medium">Bill</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((bill) => (
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
                {dateLabel(bill.billing_period_start)} \u2013 {dateLabel(bill.billing_period_end)}
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
                  data-testid={`bill-pdf-${bill.id}`}
                >
                  Download PDF
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
