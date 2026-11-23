import { Effect } from "effect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api.js";
import { useAuth } from "../../../../lib/hooks/useAuth.js";
import { Main } from "../../../../components/ui/Container.js";
import { Card } from "../../../../components/ui/Card.js";
import { Button } from "../../../../components/ui/Button.js";
import { formatCents, dateLabel, dateTimeLabel } from "../../../../components/billing/helpers.js";

export const Route = createFileRoute("/_authed/family/billing/payments/$paymentId")({
  head: () => ({ meta: [{ title: "Payment Receipt | DFG Portal" }] }),
  component: PaymentDetailPage,
  pendingComponent: () => <Main className="text-muted">Loading...</Main>,
});

function PaymentDetailPage() {
  const { paymentId } = Route.useParams();
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["family", "billing", "payment", paymentId],
    queryFn: () =>
      Effect.runPromise(api.familyBilling.paymentDetail({ params: { id: paymentId } })),
    enabled: !!user && user.role !== "admin",
  });

  if (!user || user.role === "admin") return null;

  if (isLoading) {
    return (
      <Main>
        <p className="text-sm text-muted">Loading payment details...</p>
      </Main>
    );
  }

  if (error) {
    return (
      <Main>
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load payment details.
        </p>
      </Main>
    );
  }

  if (!data) return null;

  const payment = data;

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
            <h1 className="text-2xl font-bold text-primary">
              Payment Receipt
            </h1>
            <p className="mt-1 text-sm text-muted">
              Receipt #{payment.payment_number}
            </p>
          </div>
          <a
            href={`/api/family/billing/payments/${paymentId}/receipt`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" className="px-3 py-1.5 text-xs">
              Download PDF
            </Button>
          </a>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              Amount
            </p>
            <p className="mt-1 text-xl font-bold text-primary">
              {formatCents(payment.amount_cents)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              Method
            </p>
            <p className="mt-1 text-lg font-semibold text-primary capitalize">
              {payment.method.replaceAll("_", " ")}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              Received
            </p>
            <p className="mt-1 text-lg font-semibold text-primary">
              {dateLabel(payment.received_at)}
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              Reference
            </p>
            <p className="mt-1 text-lg font-semibold text-primary">
              {payment.reference || "\u2014"}
            </p>
          </div>
        </Card>
      </div>

      {payment.allocations.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-primary">
            Applied to Bills
          </h2>
          <div className="overflow-x-auto rounded-lg border border-overlay/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-overlay/4 text-xs text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Bill #</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {payment.allocations.map((a: any) => (
                  <tr
                    key={a.id}
                    className="border-t border-overlay/8 hover:bg-overlay/4"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to="/family/billing/bills/$billId"
                        params={{ billId: a.bill_id }}
                        className="text-accent hover:underline"
                      >
                        #{a.bill_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium">{formatCents(a.amount_cents)}</td>
                    <td className="px-4 py-3 text-muted">
                      {dateTimeLabel(a.created_at)}
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
