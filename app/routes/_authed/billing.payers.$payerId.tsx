import { Effect } from "effect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Main } from "../../components/ui/Container.js";
import { PayerBillingDetailView } from "../../components/billing/PayerBillingDetail.js";

export const Route = createFileRoute("/_authed/billing/payers/$payerId")({
  head: () => ({ meta: [{ title: "Payer Billing | DFG Portal" }] }),
  component: PayerBillingPage,
  pendingComponent: () => <Main className="text-muted">Loading...</Main>,
});

function PayerBillingPage() {
  const { payerId } = Route.useParams();
  const { isAdmin } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "billing", "payer", payerId],
    queryFn: () => Effect.runPromise(api.payersAdmin.billingPayer({ params: { payerId } })),
    enabled: isAdmin,
  });

  if (!isAdmin) return null;

  return (
    <Main>
      <div className="mb-6">
        <Link
          to="/billing"
          className="text-sm text-muted hover:text-accent dark:hover:text-accent"
        >
          &larr; Back to billing
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading payer billing...</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load payer billing data.
        </p>
      ) : data ? (
        <PayerBillingDetailView data={data} payerId={payerId} onRefresh={() => refetch()} />
      ) : null}
    </Main>
  );
}
