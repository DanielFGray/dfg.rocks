import { Effect } from "effect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Main } from "../../components/ui/Container.js";
import { BillDetailView } from "../../components/billing/BillDetail.js";

export const Route = createFileRoute("/_authed/billing/bills/$billId")({
  head: () => ({ meta: [{ title: "Bill Detail | DFG Portal" }] }),
  component: BillDetailPage,
  pendingComponent: () => <Main className="text-muted dark:text-muted-dark">Loading...</Main>,
});

function BillDetailPage() {
  const { billId } = Route.useParams();
  const { isAdmin } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "billing", "bill", billId],
    queryFn: () => Effect.runPromise(api.admin.getBill({ params: { id: billId } })),
    enabled: isAdmin,
  });

  if (!isAdmin) return null;

  return (
    <Main>
      <div className="mb-6">
        <Link
          to="/billing"
          className="text-sm text-muted hover:text-accent dark:text-muted-dark dark:hover:text-accent"
        >
          &larr; Back to billing
        </Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted dark:text-muted-dark">Loading bill...</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load bill.
        </p>
      ) : data ? (
        <BillDetailView bill={data} onRefresh={() => refetch()} />
      ) : null}
    </Main>
  );
}
