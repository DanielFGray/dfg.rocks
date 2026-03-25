import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { Material, PracticeLog } from "../../lib/types.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

const assignmentsQuery = queryOptions({
  queryKey: ["assignments"],
  queryFn: async () => {
    const { data, error } = await api.assignments.get();
    if (error) throw error;
    return data;
  },
});

const practiceLogsQuery = queryOptions({
  queryKey: ["practice-logs"],
  queryFn: async () => {
    const { data, error } = await api["practice-logs"].get();
    if (error) throw error;
    return data;
  },
});

export const Route = createFileRoute("/_authed/assignments")({
  loader: async ({ context: { queryClient } }) => {
    await Promise.allSettled([
      queryClient.ensureQueryData(assignmentsQuery),
      queryClient.ensureQueryData(practiceLogsQuery),
    ]);
  },
  head: () => ({ meta: [{ title: "Assignments | DFG Portal" }] }),
  component: AssignmentsPage,
  pendingComponent: () => (
    <main className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16 text-muted">Loading...</main>
  ),
});

/* ---------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------- */

function groupByMaterial(logs: readonly PracticeLog[]): Map<string, PracticeLog[]> {
  const map = new Map<string, PracticeLog[]>();
  logs.forEach((log) => {
    const existing = map.get(log.material_id);
    if (existing) {
      existing.push(log);
    } else {
      map.set(log.material_id, [log]);
    }
  });
  return map;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${String(diffDays)} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function latestStatus(logs: PracticeLog[]): "completed" | "practiced" | null {
  if (logs.length === 0) return null;
  const sorted = [...logs].sort(
    (a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime(),
  );
  return sorted[0].status;
}

/* ---------------------------------------------------------------------------
 * AssignmentsPage
 * --------------------------------------------------------------------------- */

function AssignmentsPage() {
  const queryClient = useQueryClient();
  const [loadingMaterialId, setLoadingMaterialId] = useState<string | null>(null);

  const { data: materials } = useSuspenseQuery(assignmentsQuery);

  const { data: logs } = useSuspenseQuery(practiceLogsQuery);

  const logPracticeMutation = useMutation({
    mutationFn: async (params: { material_id: string; status: "practiced" | "completed" }) => {
      const { data, error } = await api["practice-logs"].post(params);
      if (error) throw error;
      return data;
    },
    onMutate: (params) => setLoadingMaterialId(params.material_id),
    onSettled: () => {
      setLoadingMaterialId(null);
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["practice-logs"] });
    },
  });

  const byMaterial = groupByMaterial(logs);

  return (
    <main
      data-pwid="assignments"
      className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16"
    >
      <h1 className="text-3xl font-bold tracking-tight mb-8">My Assignments</h1>

      {materials.length === 0 ? (
        <EmptyState message="No assignments yet. Your teacher will assign materials here." />
      ) : (
        <div className="flex flex-col gap-3">
          {(materials as Material[]).map((m) => {
            const materialLogs = byMaterial.get(m.id) ?? [];
            const count = materialLogs.length;
            const status = latestStatus(materialLogs);
            const lastLog =
              materialLogs.length > 0
                ? [...materialLogs].sort(
                    (a, b) =>
                      new Date(b.logged_at).getTime() -
                      new Date(a.logged_at).getTime(),
                  )[0]
                : null;
            const isBusy = loadingMaterialId === m.id;

            return (
              <Card key={m.id}>
                <div className="flex items-start gap-4">
                  {/* status indicator */}
                  <div className="pt-0.5 shrink-0">
                    {status === "completed" ? (
                      <div
                        className="w-5 h-5 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center"
                        title="Completed"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="none"
                          className="text-green-400"
                        >
                          <path
                            d="M2.5 6L5 8.5L9.5 3.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    ) : status === "practiced" ? (
                      <div
                        className="w-5 h-5 rounded-full bg-accent/20 border-2 border-accent"
                        title="Practiced"
                      />
                    ) : (
                      <div
                        className="w-5 h-5 rounded-full border-2 border-white/20"
                        title="Not started"
                      />
                    )}
                  </div>

                  {/* material info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-primary font-medium truncate">
                        {m.title}
                      </span>
                      <span className="text-muted/60 text-xs shrink-0">
                        {m.original_filename}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted/60">
                      {count > 0 ? (
                        <span>
                          Practiced {String(count)}{" "}
                          {count === 1 ? "time" : "times"}
                        </span>
                      ) : (
                        <span>Not yet practiced</span>
                      )}
                      {lastLog ? (
                        <span>Last: {formatDate(lastLog.logged_at)}</span>
                      ) : null}
                    </div>
                  </div>

                  {/* action buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      onClick={() =>
                        logPracticeMutation.mutate({
                          material_id: m.id,
                          status: "practiced",
                        })
                      }
                      disabled={isBusy}
                      className="text-xs px-3 py-1.5"
                    >
                      {isBusy ? "..." : "Practiced"}
                    </Button>
                    {status !== "completed" ? (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          logPracticeMutation.mutate({
                            material_id: m.id,
                            status: "completed",
                          })
                        }
                        disabled={isBusy}
                        className="text-xs px-3 py-1.5 text-green-400 hover:text-green-300"
                      >
                        {isBusy ? "..." : "Mark Complete"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
