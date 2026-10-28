import { Effect } from "effect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api.js";
import { useAuth } from "../../../../lib/hooks/useAuth.js";
import { Main } from "../../../../components/ui/Container.js";
import { Card } from "../../../../components/ui/Card.js";
import { Button } from "../../../../components/ui/Button.js";
import { Tabs, TabList, Tab, TabPanel } from "../../../../components/ui/Tabs.js";
import { useState } from "react";
import {
  formatCents,
  dateLabel,
  dateTimeLabel,
  billStatusBadge,
  statusLabel,
} from "../../../../components/billing/helpers.js";

export const Route = createFileRoute("/_authed/family/billing/bills/$billId")({
  head: () => ({ meta: [{ title: "Bill Detail | DFG Portal" }] }),
  component: BillDetailPage,
  pendingComponent: () => <Main className="text-muted dark:text-muted-dark">Loading...</Main>,
});

function BillDetailPage() {
  const { billId } = Route.useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState<string | number>("lineItems");

  const { data, isLoading, error } = useQuery({
    queryKey: ["family", "billing", "bill", billId],
    queryFn: () =>
      Effect.runPromise(api.familyBilling.billDetail({ path: { id: billId } })),
    enabled: !!user && user.role !== "admin",
  });

  if (!user || user.role === "admin") return null;

  if (isLoading) {
    return (
      <Main>
        <p className="text-sm text-muted dark:text-muted-dark">Loading bill...</p>
      </Main>
    );
  }

  if (error) {
    return (
      <Main>
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load bill.
        </p>
      </Main>
    );
  }

  if (!data) return null;

  const bill = data;

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

      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-primary dark:text-primary-dark">
              Bill #{bill.bill_number}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={billStatusBadge(bill.status)}>
              {statusLabel(bill.status)}
            </span>
            <a
              href={`/api/family/billing/bills/${billId}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" className="px-3 py-1.5 text-xs">
                Download PDF
              </Button>
            </a>
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted dark:text-muted-dark">
              Subtotal
            </p>
            <p className="mt-1 text-lg font-bold text-primary dark:text-primary-dark">
              {formatCents(bill.subtotal_cents)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted dark:text-muted-dark">
              Discount
            </p>
            <p className="mt-1 text-lg font-bold text-green-600 dark:text-green-400">
              {bill.discount_cents > 0 ? `-${formatCents(bill.discount_cents)}` : "\u2014"}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted dark:text-muted-dark">
              Tax
            </p>
            <p className="mt-1 text-lg font-bold text-primary dark:text-primary-dark">
              {bill.tax_cents > 0 ? formatCents(bill.tax_cents) : "\u2014"}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-primary dark:text-primary-dark">
              Total
            </p>
            <p className="mt-1 text-lg font-bold text-primary dark:text-primary-dark">
              {formatCents(bill.total_cents)}
            </p>
          </div>
        </Card>
      </div>

      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted dark:text-muted-dark">
        <span>
          Period: {dateLabel(bill.billing_period_start)} \u2013 {dateLabel(bill.billing_period_end)}
        </span>
        {bill.due_date && <span>Due: {dateLabel(bill.due_date)}</span>}
        {bill.issued_at && <span>Issued: {dateTimeLabel(bill.issued_at)}</span>}
        {bill.paid_at && <span className="text-green-600 dark:text-green-400">Paid: {dateTimeLabel(bill.paid_at)}</span>}
      </div>

      <Tabs selectedKey={tab} onSelectionChange={setTab}>
        <TabList>
          <Tab id="lineItems">Line Items</Tab>
          {bill.adjustments.length > 0 && <Tab id="adjustments">Adjustments</Tab>}
          {bill.credit_applications.length > 0 && <Tab id="credits">Credit Applications</Tab>}
        </TabList>

        <TabPanel id="lineItems" className="mt-6">
          {bill.line_items.length === 0 ? (
            <p className="text-sm text-muted dark:text-muted-dark">No line items.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
                  <tr>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Qty</th>
                    <th className="px-4 py-3 font-medium">Unit Price</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.line_items.map((li: any) => (
                    <tr key={li.id} className="border-t border-overlay/8 dark:border-overlay-dark/8">
                      <td className="px-4 py-3 font-medium text-primary dark:text-primary-dark">
                        {li.description}
                      </td>
                      <td className="px-4 py-3 text-muted dark:text-muted-dark">
                        {statusLabel(li.line_type)}
                      </td>
                      <td className="px-4 py-3">{li.quantity}</td>
                      <td className="px-4 py-3">{formatCents(li.unit_price_cents)}</td>
                      <td className="px-4 py-3 font-medium">{formatCents(li.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-overlay/4 text-xs dark:bg-overlay-dark/4">
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right font-medium">Subtotal</td>
                    <td className="px-4 py-2 font-medium">{formatCents(bill.subtotal_cents)}</td>
                  </tr>
                  {bill.discount_cents > 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-2 text-right text-muted dark:text-muted-dark">Discount</td>
                      <td className="px-4 py-2 text-green-600 dark:text-green-400">-{formatCents(bill.discount_cents)}</td>
                    </tr>
                  )}
                  {bill.tax_cents > 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-2 text-right text-muted dark:text-muted-dark">Tax</td>
                      <td className="px-4 py-2">{formatCents(bill.tax_cents)}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right font-semibold text-primary dark:text-primary-dark">Total</td>
                    <td className="px-4 py-2 font-bold text-primary dark:text-primary-dark">{formatCents(bill.total_cents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </TabPanel>

        {bill.adjustments.length > 0 && (
          <TabPanel id="adjustments" className="mt-6">
            <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
                  <tr>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.adjustments.map((adj: any) => (
                    <tr key={adj.id} className="border-t border-overlay/8 dark:border-overlay-dark/8">
                      <td className="px-4 py-3 font-medium">
                        <span className={adj.amount_cents < 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                          {adj.amount_cents < 0 ? "-" : "+"}{formatCents(Math.abs(adj.amount_cents))}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted dark:text-muted-dark">
                        {dateTimeLabel(adj.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabPanel>
        )}

        {bill.credit_applications.length > 0 && (
          <TabPanel id="credits" className="mt-6">
            <div className="overflow-x-auto rounded-lg border border-overlay/10 dark:border-overlay-dark/10">
              <table className="w-full text-left text-sm">
                <thead className="bg-overlay/4 text-xs text-muted dark:bg-overlay-dark/4 dark:text-muted-dark">
                  <tr>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.credit_applications.map((ca: any) => (
                    <tr key={ca.id} className="border-t border-overlay/8 dark:border-overlay-dark/8">
                      <td className="px-4 py-3 font-medium text-green-600 dark:text-green-400">
                        -{formatCents(ca.amount_cents)}
                      </td>
                      <td className="px-4 py-3 text-muted dark:text-muted-dark">
                        {dateTimeLabel(ca.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabPanel>
        )}
      </Tabs>
    </Main>
  );
}
