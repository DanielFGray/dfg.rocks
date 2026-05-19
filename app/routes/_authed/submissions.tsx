import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { Submission } from "../../lib/types.js";
import { getSubmissionsPageData } from "../../lib/routeData.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

export const Route = createFileRoute("/_authed/submissions")({
  loader: () => getSubmissionsPageData(),
  head: () => ({ meta: [{ title: "Submissions | DFG Portal" }] }),
  component: SubmissionsPage,
  pendingComponent: () => (
    <main className="px-5 md:px-8 pt-20 pb-16 text-muted dark:text-muted-dark mx-auto max-w-[1100px]">
      Loading...
    </main>
  ),
});

function SubmissionsPage() {
  const router = useRouter();
  const { items } = Route.useLoaderData();

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.admin.submissions({ id }).patch({ is_read: true });
      if (error) throw error;
      if ("error" in data) throw data.error;
      return data;
    },
    onSettled: () => {
      void router.invalidate();
    },
  });

  return (
    <main data-testid="submissions" className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]">
      <h1 className="text-3xl font-bold tracking-tight mb-8">Contact Submissions</h1>

      {items.length === 0 ? (
        <EmptyState message="No submissions yet." />
      ) : (
        <div className="gap-3 flex flex-col">
          {items.map((s) => (
            <Card key={s.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="gap-3 mb-1 flex items-center">
                    <span className="font-semibold text-primary dark:text-primary-dark">
                      {s.name}
                    </span>
                    {!s.is_read ? (
                      <span className="bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent rounded-full">
                        New
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted dark:text-muted-dark">
                    {s.email} · {s.instrument} · {s.format}
                  </p>
                  {s.message ? (
                    <p className="text-sm text-muted/80 dark:text-muted-dark/80 mt-2">
                      {s.message}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted/40 dark:text-muted-dark/40 mt-2">
                    {s.created_at}
                  </p>
                </div>
                {!s.is_read ? (
                  <Button variant="ghost" onClick={() => markReadMutation.mutate(s.id)}>
                    Mark Read
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
