import * as Effect from "effect/Effect";
import { Atom, AtomRegistry, Suspense } from "fibrae";
import { NavigatorTag } from "fibrae/router";
import { DfgApi, type Material, type PracticeLog } from "./api.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { EmptyState } from "../ui/empty_state.js";

/* ---------------------------------------------------------------------------
 * Atoms — track practice logs so UI updates after logging
 * --------------------------------------------------------------------------- */

const practiceLogsAtom = Atom.make<readonly PracticeLog[]>([]);
const loadingMaterial = Atom.make<string | null>(null);

/* ---------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------- */

function groupByMaterial(logs: readonly PracticeLog[]): Map<string, PracticeLog[]> {
  const map = new Map<string, PracticeLog[]>();
  for (const log of logs) {
    const existing = map.get(log.material_id);
    if (existing) {
      existing.push(log);
    } else {
      map.set(log.material_id, [log]);
    }
  }
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
  // sort by logged_at desc
  const sorted = [...logs].sort(
    (a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime(),
  );
  return sorted[0].status;
}

/* ---------------------------------------------------------------------------
 * AssignmentsList — main Effect component
 * --------------------------------------------------------------------------- */

function AssignmentsList() {
  return Effect.gen(function* () {
    const api = yield* DfgApi;
    const registry = yield* AtomRegistry.AtomRegistry;

    // fetch assignments and practice logs in parallel
    const [materials, logs] = yield* Effect.all([
      api.authenticated.assignments({}),
      api.authenticated.practiceLogs({ urlParams: {} }),
    ]);

    // seed the atom with fetched logs
    registry.set(practiceLogsAtom, logs);

    if (materials.length === 0) {
      return (
        <EmptyState message="No assignments yet. Your teacher will assign materials here." />
      );
    }

    const currentLogs = registry.get(practiceLogsAtom);
    const byMaterial = groupByMaterial(currentLogs);
    const busyId = registry.get(loadingMaterial);

    /* -- refresh after mutation -- */
    const refresh = Effect.gen(function* () {
      const navigator = yield* NavigatorTag;
      yield* navigator.go("/assignments");
    });

    /* -- log practice handler -- */
    const handleLog =
      (materialId: string, status: "practiced" | "completed") => () => {
        registry.set(loadingMaterial, materialId);
        return Effect.gen(function* () {
          const api = yield* DfgApi;
          yield* api.authenticated.logPractice({ payload: { material_id: materialId, status } });
          registry.set(loadingMaterial, null);
          yield* refresh;
        });
      };

    return (
      <div class="flex flex-col gap-3">
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
          const isBusy = busyId === m.id;

          return (
            <Card>
              <div class="flex items-start gap-4">
                {/* status indicator */}
                <div class="pt-0.5 shrink-0">
                  {status === "completed" ? (
                    <div
                      class="w-5 h-5 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center"
                      title="Completed"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        class="text-green-400"
                      >
                        <path
                          d="M2.5 6L5 8.5L9.5 3.5"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </div>
                  ) : status === "practiced" ? (
                    <div
                      class="w-5 h-5 rounded-full bg-accent/20 border-2 border-accent"
                      title="Practiced"
                    />
                  ) : (
                    <div
                      class="w-5 h-5 rounded-full border-2 border-white/20"
                      title="Not started"
                    />
                  )}
                </div>

                {/* material info */}
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-3 mb-1">
                    <span class="text-primary font-medium truncate">
                      {m.title}
                    </span>
                    <span class="text-muted/60 text-xs shrink-0">
                      {m.original_filename}
                    </span>
                  </div>
                  <div class="flex items-center gap-4 text-xs text-muted/60">
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
                <div class="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    onclick={handleLog(m.id, "practiced")}
                    disabled={isBusy}
                    class="text-xs px-3 py-1.5"
                  >
                    {isBusy ? "..." : "Practiced"}
                  </Button>
                  {status !== "completed" ? (
                    <Button
                      variant="ghost"
                      onclick={handleLog(m.id, "completed")}
                      disabled={isBusy}
                      class="text-xs px-3 py-1.5 text-green-400 hover:text-green-300"
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
    );
  });
}

/* ---------------------------------------------------------------------------
 * AssignmentsPage — public export
 * --------------------------------------------------------------------------- */

export const AssignmentsPage = () => (
  <main
    data-cy="assignments"
    class="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16"
  >
    <h1 class="text-3xl font-bold tracking-tight mb-8">My Assignments</h1>
    <Suspense
      fallback={<p class="text-muted">Loading assignments...</p>}
      threshold={50}
    >
      <AssignmentsList />
    </Suspense>
  </main>
);
