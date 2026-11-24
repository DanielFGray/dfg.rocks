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
import { Table, TableHead, Tr, Th, Td } from "../../../components/ui/Table.js";

export const Route = createFileRoute("/_authed/family/billing/")({
  head: () => ({ meta: [{ title: "Billing | DFG Portal" }] }),
  component: FamilyBillingOverviewPage,
  pendingComponent: () => <Main className="text-muted">Loading...</Main>,
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
        <p className="text-sm text-muted">Loading billing data...</p>
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

  const { balance, open_bills, overdue_bills, recent_payments, credits } = data;

  return (
    <Main>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-primary">Billing</h1>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              Gross Outstanding
            </p>
            <p className="mt-1 text-2xl font-bold text-primary">
              {formatCents(balance.gross_outstanding_cents)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              Available Credit
            </p>
            <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">
              {formatCents(balance.available_credit_cents)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Net Due</p>
            <p
              className={`mt-1 text-2xl font-bold ${balance.net_due_cents > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
            >
              {formatCents(balance.net_due_cents)}
            </p>
          </div>
        </Card>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Outstanding</p>
            <p className="mt-1 text-lg font-semibold text-primary">
              {formatCents(balance.outstanding_cents)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-red-600 uppercase dark:text-red-400">
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
        <h2 className="mb-4 text-lg font-semibold text-primary">Open Bills</h2>
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
        <h2 className="mb-4 text-lg font-semibold text-primary">Recent Payments</h2>
        {recent_payments.length === 0 ? (
          <EmptyState message="No payments recorded." />
        ) : (
          <Table>
            <TableHead>
              <Th>Payment #</Th>
              <Th>Amount</Th>
              <Th>Method</Th>
              <Th>Date</Th>
              <Th>Receipt</Th>
            </TableHead>
            <tbody>
              {recent_payments.map((p) => (
                <Tr key={p.id} hover>
                  <Td className="font-medium text-primary">#{p.payment_number}</Td>
                  <Td>{formatCents(p.amount_cents)}</Td>
                  <Td className="capitalize">{p.method.replaceAll("_", " ")}</Td>
                  <Td className="text-muted">{dateLabel(p.received_at)}</Td>
                  <Td>
                    <Link
                      to="/family/billing/payments/$paymentId"
                      params={{ paymentId: p.id }}
                      className="text-sm text-accent hover:underline"
                    >
                      View receipt
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="mt-4">
          <Link to="/family/billing/bills" className="text-sm text-accent hover:underline">
            View all bills &rarr;
          </Link>
        </div>
      </section>

      {/* Credits section */}
      {credits.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-primary">Active Credits</h2>
          <Table>
            <TableHead>
              <Th>Amount</Th>
              <Th>Reason</Th>
              <Th>Issued</Th>
              <Th>Expires</Th>
            </TableHead>
            <tbody>
              {credits
                .filter((c) => !c.consumed_at)
                .map((c) => (
                  <Tr key={c.id} hover>
                    <Td className="font-medium">{formatCents(c.amount_cents)}</Td>
                    <Td className="text-muted">{c.reason}</Td>
                    <Td className="text-muted">{dateLabel(c.created_at)}</Td>
                    <Td className="text-muted">
                      {c.expires_at ? dateLabel(c.expires_at) : "\u2014"}
                    </Td>
                  </Tr>
                ))}
            </tbody>
          </Table>
        </section>
      )}
    </Main>
  );
}

function BillTable({ bills }: { bills: readonly any[] }) {
  return (
    <Table>
      <TableHead>
        <Th>Bill #</Th>
        <Th>Status</Th>
        <Th>Period</Th>
        <Th>Due</Th>
        <Th>Total</Th>
        <Th>Bill</Th>
      </TableHead>
      <tbody>
        {bills.map((bill) => (
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
              {dateLabel(bill.billing_period_start)} \u2013 {dateLabel(bill.billing_period_end)}
            </Td>
            <Td>{bill.due_date ? dateLabel(bill.due_date) : "\u2014"}</Td>
            <Td className="font-medium">{formatCents(bill.total_cents)}</Td>
            <Td>
              <a
                href={`/api/family/billing/bills/${bill.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent hover:underline"
                data-testid={`bill-pdf-${bill.id}`}
              >
                Download PDF
              </a>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
