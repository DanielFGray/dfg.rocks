import { Effect } from "effect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Main } from "../../components/ui/Container.js";
import { FamilyBillingDetailView } from "../../components/billing/FamilyBillingDetail.js";

export const Route = createFileRoute("/_authed/billing/families/$familyId")({
  head: () => ({ meta: [{ title: "Family Billing | DFG Portal" }] }),
  component: FamilyBillingPage,
  pendingComponent: () => <Main className="text-muted dark:text-muted-dark">Loading...</Main>,
});

function FamilyBillingPage() {
  const { familyId } = Route.useParams();
  const { isAdmin } = useAuth();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "billing", "family", familyId],
    queryFn: () =>
      Effect.runPromise(api.admin.billingFamily({ path: { familyId } })),
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
        <p className="text-sm text-muted dark:text-muted-dark">Loading family billing...</p>
      ) : error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Failed to load family billing data.
        </p>
      ) : data ? (
        <FamilyBillingDetailView data={data} familyId={familyId} onRefresh={() => refetch()} />
      ) : null}
    </Main>
  );
}
