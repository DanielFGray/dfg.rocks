import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { adminSubmissionsQuery } from "../../lib/queries.js";
import type { Submission } from "../../lib/types.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

export const Route = createFileRoute("/_authed/submissions")({
  loader: ({ context }) => context.queryClient.ensureQueryData(adminSubmissionsQuery),
  head: () => ({ meta: [{ title: "Submissions | DFG Portal" }] }),
  component: SubmissionsPage,
  pendingComponent: () => (
    <main className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16 text-muted">Loading...</main>
  ),
});

function SubmissionsPage() {
  const queryClient = useQueryClient();

  const { data: items } = useSuspenseQuery(adminSubmissionsQuery);

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.admin.submissions({ id }).patch({ is_read: true });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "submissions"] });
    },
  });

  return (
    <main data-pwid="submissions" className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16">
      <h1 className="text-3xl font-bold tracking-tight mb-8">Contact Submissions</h1>

      {(items as Submission[]).length === 0 ? (
        <EmptyState message="No submissions yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {(items as Submission[]).map((s) => (
            <Card key={s.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-semibold text-primary">{s.name}</span>
                    {!s.is_read ? (
                      <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">New</span>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted">{s.email} · {s.instrument} · {s.format}</p>
                  {s.message ? <p className="text-sm text-muted/80 mt-2">{s.message}</p> : null}
                  <p className="text-xs text-muted/40 mt-2">{s.created_at}</p>
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
