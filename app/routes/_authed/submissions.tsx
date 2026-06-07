import { Effect } from "effect";
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { adminSubmissionsQuery } from "../../lib/queries.js";
import type { Submission } from "../../../shared/schemas.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Main } from "../../components/ui/Container.js";

const PAGE_SIZE = 25;

export const Route = createFileRoute("/_authed/submissions")({
  head: () => ({
    meta: [{ title: "Submissions | DFG Portal" }],
  }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(adminSubmissionsQuery),
  component: SubmissionsPage,
  pendingComponent: () => (
    <Main className="text-muted dark:text-muted-dark">Loading...</Main>
  ),
});

function SubmissionsPage() {
  const queryClient = useQueryClient();
  const { data: allSubmissions } = useSuspenseQuery(adminSubmissionsQuery);

  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = [...allSubmissions].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleRead = useMutation({
    mutationFn: (s: Submission) =>
      Effect.runPromise(
        api.admin.updateSubmission({
          path: { id: s.id },
          payload: { is_read: !s.is_read },
        }),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: adminSubmissionsQuery.queryKey,
      });
    },
  });

  const formatPhone = (phone: string | null | undefined) => {
    if (!phone) return null;
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length === 10)
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    if (cleaned.length === 11)
      return `+${cleaned[0]} (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    return phone;
  };

  return (
    <Main data-testid="submissions">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">
          Contact Submissions
        </h1>
        {allSubmissions.length > 0 ? (
          <span className="rounded-full bg-accent/12 px-3 py-1 text-sm font-semibold text-accent">
            {allSubmissions.length} total
          </span>
        ) : null}
      </div>

      {paged.length === 0 ? (
        <EmptyState message="No contact submissions yet." />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {paged.map((s) => (
              <div
                key={s.id}
                className={`rounded-xl border bg-card p-5 transition-colors dark:bg-card-dark ${
                  s.is_read
                    ? "border-overlay/6 dark:border-overlay-dark/6"
                    : "border-accent/40 bg-accent/3 dark:border-accent-dark/40 dark:bg-accent-dark/3"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold text-primary dark:text-primary-dark">
                        {s.name}
                      </span>
                      {!s.is_read ? (
                        <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[0.7rem] font-semibold text-accent uppercase tracking-wide">
                          New
                        </span>
                      ) : null}
                    </div>
                    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted dark:text-muted-dark">
                      <a
                        href={`mailto:${s.email}`}
                        className="text-accent hover:underline"
                      >
                        {s.email}
                      </a>
                      {s.phone ? <span>{formatPhone(s.phone)}</span> : null}
                      <span className="rounded-full border border-overlay/10 px-2 py-0.5 text-xs dark:border-overlay-dark/10">
                        {s.instrument}
                      </span>
                      <span className="rounded-full border border-overlay/10 px-2 py-0.5 text-xs dark:border-overlay-dark/10">
                        {s.format}
                      </span>
                    </div>
                    {s.message ? (
                      <div className="text-sm text-muted dark:text-muted-dark">
                        {s.message.length > 200 &&
                        expandedId !== s.id ? (
                          <>
                            {s.message.slice(0, 200)}...
                            <button
                              type="button"
                              onClick={() => setExpandedId(s.id)}
                              className="ml-1 text-accent hover:underline"
                            >
                              Show more
                            </button>
                          </>
                        ) : s.message.length > 200 ? (
                          <>
                            {s.message}
                            <button
                              type="button"
                              onClick={() => setExpandedId(null)}
                              className="ml-1 text-accent hover:underline"
                            >
                              Show less
                            </button>
                          </>
                        ) : (
                          s.message
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <time
                      dateTime={s.created_at}
                      className="whitespace-nowrap text-xs text-muted dark:text-muted-dark"
                    >
                      {new Date(s.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year:
                          new Date(s.created_at).getFullYear() !==
                          new Date().getFullYear()
                            ? "numeric"
                            : undefined,
                      })}
                    </time>
                    <Button
                      variant="ghost"
                      onClick={() => toggleRead.mutate(s)}
                      disabled={toggleRead.isPending}
                      className="whitespace-nowrap px-3 py-1.5 text-xs"
                    >
                      {s.is_read ? "Mark unread" : "Mark read"}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 ? (
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-4 py-2 text-xs"
              >
                Previous
              </Button>
              <span className="text-sm text-muted dark:text-muted-dark">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                onClick={() =>
                  setPage(Math.min(totalPages - 1, page + 1))
                }
                disabled={page >= totalPages - 1}
                className="px-4 py-2 text-xs"
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Main>
  );
}
