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
import { Table, TableHead, TableFoot, Tr, Th, Td } from "../../../../components/ui/Table.js";

export const Route = createFileRoute("/_authed/family/billing/bills/$billId")({
  head: () => ({ meta: [{ title: "Bill Detail | DFG Portal" }] }),
  component: BillDetailPage,
  pendingComponent: () => <Main className="text-muted">Loading...</Main>,
});

function BillDetailPage() {
  const { billId } = Route.useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState<string | number>("lineItems");

  const { data, isLoading, error } = useQuery({
    queryKey: ["family", "billing", "bill", billId],
    queryFn: () => Effect.runPromise(api.familyBilling.billDetail({ params: { id: billId } })),
    enabled: !!user && user.role !== "admin",
  });

  if (!user || user.role === "admin") return null;

  if (isLoading) {
    return (
      <Main>
        <p className="text-sm text-muted">Loading bill...</p>
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
          className="text-sm text-muted hover:text-accent dark:hover:text-accent"
        >
          &larr; Back to billing
        </Link>
      </div>

      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-primary">Bill #{bill.bill_number}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={billStatusBadge(bill.status)}>{statusLabel(bill.status)}</span>
            <a
              href={`/api/family/billing/bills/${billId}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                Download PDF
              </Button>
            </a>
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Subtotal</p>
            <p className="mt-1 text-lg font-bold text-primary">
              {formatCents(bill.subtotal_cents)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Discount</p>
            <p className="mt-1 text-lg font-bold text-green-600 dark:text-green-400">
              {bill.discount_cents > 0 ? `-${formatCents(bill.discount_cents)}` : "\u2014"}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Tax</p>
            <p className="mt-1 text-lg font-bold text-primary">
              {bill.tax_cents > 0 ? formatCents(bill.tax_cents) : "\u2014"}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-primary uppercase">Total</p>
            <p className="mt-1 text-lg font-bold text-primary">{formatCents(bill.total_cents)}</p>
          </div>
        </Card>
      </div>

      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
        <span>
          Period: {dateLabel(bill.billing_period_start)} \u2013 {dateLabel(bill.billing_period_end)}
        </span>
        {bill.due_date && <span>Due: {dateLabel(bill.due_date)}</span>}
        {bill.issued_at && <span>Issued: {dateTimeLabel(bill.issued_at)}</span>}
        {bill.paid_at && (
          <span className="text-green-600 dark:text-green-400">
            Paid: {dateTimeLabel(bill.paid_at)}
          </span>
        )}
      </div>

      <Tabs selectedKey={tab} onSelectionChange={setTab}>
        <TabList>
          <Tab id="lineItems">Line Items</Tab>
          {bill.adjustments.length > 0 && <Tab id="adjustments">Adjustments</Tab>}
          {bill.credit_applications.length > 0 && <Tab id="credits">Credit Applications</Tab>}
        </TabList>

        <TabPanel id="lineItems" className="mt-6">
          {bill.line_items.length === 0 ? (
            <p className="text-sm text-muted">No line items.</p>
          ) : (
            <Table>
              <TableHead>
                <Th>Description</Th>
                <Th>Type</Th>
                <Th>Qty</Th>
                <Th>Unit Price</Th>
                <Th>Amount</Th>
              </TableHead>
              <tbody>
                {bill.line_items.map((li: any) => (
                  <Tr key={li.id}>
                    <Td className="font-medium text-primary">{li.description}</Td>
                    <Td className="text-muted">{statusLabel(li.line_type)}</Td>
                    <Td>{li.quantity}</Td>
                    <Td>{formatCents(li.unit_price_cents)}</Td>
                    <Td className="font-medium">{formatCents(li.amount_cents)}</Td>
                  </Tr>
                ))}
              </tbody>
              <TableFoot>
                <tr>
                  <Td colSpan={4} className="py-2 text-right font-medium">
                    Subtotal
                  </Td>
                  <Td className="py-2 font-medium">{formatCents(bill.subtotal_cents)}</Td>
                </tr>
                {bill.discount_cents > 0 && (
                  <tr>
                    <Td colSpan={4} className="py-2 text-right text-muted">
                      Discount
                    </Td>
                    <Td className="py-2 text-green-600 dark:text-green-400">
                      -{formatCents(bill.discount_cents)}
                    </Td>
                  </tr>
                )}
                {bill.tax_cents > 0 && (
                  <tr>
                    <Td colSpan={4} className="py-2 text-right text-muted">
                      Tax
                    </Td>
                    <Td className="py-2">{formatCents(bill.tax_cents)}</Td>
                  </tr>
                )}
                <tr>
                  <Td colSpan={4} className="py-2 text-right font-semibold text-primary">
                    Total
                  </Td>
                  <Td className="py-2 font-bold text-primary">{formatCents(bill.total_cents)}</Td>
                </tr>
              </TableFoot>
            </Table>
          )}
        </TabPanel>

        {bill.adjustments.length > 0 && (
          <TabPanel id="adjustments" className="mt-6">
            <Table>
              <TableHead>
                <Th>Amount</Th>
                <Th>Date</Th>
              </TableHead>
              <tbody>
                {bill.adjustments.map((adj: any) => (
                  <Tr key={adj.id}>
                    <Td className="font-medium">
                      <span
                        className={
                          adj.amount_cents < 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }
                      >
                        {adj.amount_cents < 0 ? "-" : "+"}
                        {formatCents(Math.abs(adj.amount_cents))}
                      </span>
                    </Td>
                    <Td className="text-muted">{dateTimeLabel(adj.created_at)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TabPanel>
        )}

        {bill.credit_applications.length > 0 && (
          <TabPanel id="credits" className="mt-6">
            <Table>
              <TableHead>
                <Th>Amount</Th>
                <Th>Date</Th>
              </TableHead>
              <tbody>
                {bill.credit_applications.map((ca: any) => (
                  <Tr key={ca.id}>
                    <Td className="font-medium text-green-600 dark:text-green-400">
                      -{formatCents(ca.amount_cents)}
                    </Td>
                    <Td className="text-muted">{dateTimeLabel(ca.created_at)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TabPanel>
        )}
      </Tabs>
    </Main>
  );
}
