import * as Effect from "effect/Effect";
import { AtomRegistry, Suspense } from "fibrae";
import { DfgApi, type Submission } from "./api.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { EmptyState } from "../ui/empty_state.js";
import { NavigatorTag } from "fibrae/router";

function SubmissionList() {
  return Effect.gen(function* () {
    const api = yield* DfgApi;
    const items = yield* api.admin.submissions({ urlParams: {} });

    const handleMarkRead = (id: string) => () =>
      Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.admin.patchSubmission({ path: { id }, payload: { is_read: true } });
        const navigator = yield* NavigatorTag;
        yield* navigator.go("/submissions");
      });

    return (
      <div>
        <h1 class="text-3xl font-bold tracking-tight mb-8">Contact Submissions</h1>

        {items.length === 0 ? (
          <EmptyState message="No submissions yet." />
        ) : (
          <div class="flex flex-col gap-3">
            {(items as Submission[]).map((s) => (
              <Card>
                <div class="flex items-start justify-between">
                  <div>
                    <div class="flex items-center gap-3 mb-1">
                      <span class="font-semibold text-primary">{s.name}</span>
                      {!s.is_read ? (
                        <span class="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">New</span>
                      ) : null}
                    </div>
                    <p class="text-sm text-muted">{s.email} · {s.instrument} · {s.format}</p>
                    {s.message ? <p class="text-sm text-muted/80 mt-2">{s.message}</p> : null}
                    <p class="text-xs text-muted/40 mt-2">{s.created_at}</p>
                  </div>
                  {!s.is_read ? (
                    <Button variant="ghost" onclick={handleMarkRead(s.id)}>Mark Read</Button>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  });
}

export const SubmissionsPage = () => (
  <main data-cy="submissions" class="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16">
    <Suspense fallback={<p class="text-muted">Loading submissions...</p>} threshold={50}>
      <SubmissionList />
    </Suspense>
  </main>
);
