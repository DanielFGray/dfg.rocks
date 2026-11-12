import { useState } from "react";
import { Effect } from "effect";
import { withAuthContext } from "../../../server/requestDatabase.js";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import type { Lesson, LessonCancellationPolicy, LessonNote } from "../../../shared/schemas.js";
import { Card } from "../../components/ui/Card.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Disclosure, DisclosureTrigger, DisclosurePanel } from "../../components/ui/Disclosure.js";
import { Button } from "../../components/ui/Button.js";
import { Modal } from "../../components/ui/Modal.js";
import { api } from "../../lib/api.js";
import { getErrorMessage } from "../../lib/errors.js";
import { runServerEffect } from "../../lib/serverEffect.js";
import { LessonService } from "../../../server/services/lessonService.js";
import { serializeLesson, serializeLessonNote } from "../../../shared/responseMappers.js";
import { formatDateTime } from "../../components/lessons/helpers.js";
import { requireSession, resolveEffectiveStudent } from "../../lib/sessionGuards.server.js";

type MyLessonsPageData = {
  lessons: Lesson[];
  notes: LessonNote[];
};

const getMyLessonsPageData = createServerFn({ method: "GET" }).handler(() =>
  runServerEffect(
    Effect.gen(function* () {
      const session = yield* requireSession(getCookie("session"));
      const lessonService = yield* LessonService;

      const effective = resolveEffectiveStudent(session);
      const filterStudentId = effective.isActing ? effective.studentId : undefined;

      const [lessons, notes] = yield* Effect.all([
        lessonService.myLessons({ limit: 50, offset: 0 }, filterStudentId),
        lessonService.myLessonNotesList({ limit: 100, offset: 0 }, filterStudentId),
      ]).pipe(withAuthContext(session.session.id));

      return {
        lessons: lessons.map(serializeLesson),
        notes: notes.map(serializeLessonNote),
      } satisfies MyLessonsPageData;
    }),
  ),
);

export const Route = createFileRoute("/_authed/my-lessons")({
  head: () => ({ meta: [{ title: "My Lessons | DFG Portal" }] }),
  loader: () => getMyLessonsPageData(),
  component: MyLessonsPage,
  pendingComponent: () => (
    <main className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 text-muted md:px-8 dark:text-muted-dark">
      Loading...
    </main>
  ),
});

/* ---------------------------------------------------------------------------
 * Constants
 * --------------------------------------------------------------------------- */

const statusBadgeClass: Record<string, string> = {
  scheduled: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  cancelled: "bg-red-500/20 text-red-600 dark:text-red-400",
  no_show: "bg-amber-500/20 text-amber-400",
};

const statusLabel: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

const locationLabel: Record<string, string> = {
  in_person_teacher_travels: "In-Person (Teacher Travels)",
  in_person_student_travels: "In-Person (Student Travels)",
  studio: "Studio",
  online: "Online",
};

function toLocalDateTimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isFutureScheduledLesson(lesson: Lesson): boolean {
  return lesson.status === "scheduled" && lesson.scheduled_at.getTime() > Date.now();
}

function formatMoney(amountCents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amountCents / 100);
}

function PolicySummary({ policy }: { policy: LessonCancellationPolicy }) {
  const amount = formatMoney(policy.amount_cents);
  let outcome: string;

  if (policy.billing_model === "monthly_prepaid") {
    outcome =
      policy.fee_outcome === "recorded"
        ? `A ${amount} monthly cancellation fee will be recorded.`
        : "No monthly cancellation fee will be recorded.";
  } else if (policy.deposit_outcome === "refunded") {
    outcome = `Your ${amount} deposit will be refunded.`;
  } else if (policy.deposit_outcome === "captured") {
    outcome = `Your ${amount} deposit will be captured.`;
  } else {
    outcome = "No deposit will be refunded or captured.";
  }

  return (
    <section
      data-testid="cancellation-policy"
      aria-label="Cancellation policy"
      className="rounded-lg border border-overlay/10 bg-overlay/3 p-4 text-sm dark:border-overlay-dark/10 dark:bg-overlay-dark/3"
    >
      <p className="font-semibold text-primary dark:text-primary-dark">
        {policy.is_late ? "Late cancellation policy" : "Cancellation policy"}
      </p>
      <p className="mt-1 text-muted dark:text-muted-dark">{outcome}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted dark:text-muted-dark">
        <dt>Billing</dt>
        <dd>{policy.billing_model === "monthly_prepaid" ? "Monthly prepaid" : "Single booking"}</dd>
        <dt>Amount</dt>
        <dd>{amount}</dd>
      </dl>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * NoteSection — render fields that have content
 * --------------------------------------------------------------------------- */

function NoteSection({ note }: { note: LessonNote }) {
  const hasContent =
    note.topics_covered || note.homework || note.progress_observations || note.notes;

  if (!hasContent) {
    return (
      <div className="mt-4 border-t border-overlay/5 pt-4 dark:border-overlay-dark/5">
        <p className="text-sm text-muted dark:text-muted-dark">No details in this note.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-overlay/5 pt-4 dark:border-overlay-dark/5">
      {note.topics_covered ? (
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wider text-muted uppercase dark:text-muted-dark">
            Topics Covered
          </p>
          <p className="text-sm text-primary dark:text-primary-dark">{note.topics_covered}</p>
        </div>
      ) : null}
      {note.homework ? (
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wider text-muted uppercase dark:text-muted-dark">
            Homework
          </p>
          <p className="text-sm text-primary dark:text-primary-dark">{note.homework}</p>
        </div>
      ) : null}
      {note.progress_observations ? (
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wider text-muted uppercase dark:text-muted-dark">
            Progress
          </p>
          <p className="text-sm text-primary dark:text-primary-dark">
            {note.progress_observations}
          </p>
        </div>
      ) : null}
      {note.notes ? (
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wider text-muted uppercase dark:text-muted-dark">
            Notes
          </p>
          <p className="text-sm text-primary dark:text-primary-dark">{note.notes}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * MyLessonsPage
 * --------------------------------------------------------------------------- */

function MyLessonsPage() {
  const router = useRouter();
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Lesson | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Lesson | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [rescheduleValidationError, setRescheduleValidationError] = useState<string | null>(null);
  const { lessons, notes } = Route.useLoaderData();

  const policyMutation = useMutation({
    mutationFn: (lessonId: string) =>
      Effect.runPromise(api.lessons.myLessonCancellationPolicy({ params: { id: lessonId } })),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ lessonId, reason }: { lessonId: string; reason?: string }) =>
      Effect.runPromise(
        api.lessons.cancelMyLesson({
          params: { id: lessonId },
          payload: reason ? { reason } : {},
        }),
      ),
    onSuccess: () => {
      setCancelTarget(null);
      setCancellationReason("");
      policyMutation.reset();
      void router.invalidate();
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: ({ lessonId, scheduledAt }: { lessonId: string; scheduledAt: Date }) =>
      Effect.runPromise(
        api.lessons.rescheduleMyLesson({
          params: { id: lessonId },
          payload: { scheduled_at: scheduledAt },
        }),
      ),
    onSuccess: () => {
      setRescheduleTarget(null);
      setNewScheduledAt("");
      policyMutation.reset();
      void router.invalidate();
    },
  });

  const noteMap = new Map<string, LessonNote>();
  notes.forEach((n: LessonNote) => {
    noteMap.set(n.lesson_id, n);
  });

  const toggleExpand = (id: string) => {
    setExpandedLessonId((prev) => (prev === id ? null : id));
  };

  const openCancel = (lesson: Lesson) => {
    cancelMutation.reset();
    policyMutation.reset();
    setCancellationReason("");
    setCancelTarget(lesson);
    policyMutation.mutate(lesson.id);
  };

  const closeCancel = () => {
    if (cancelMutation.isPending) return;
    setCancelTarget(null);
    setCancellationReason("");
    policyMutation.reset();
  };

  const openReschedule = (lesson: Lesson) => {
    rescheduleMutation.reset();
    policyMutation.reset();
    setRescheduleValidationError(null);
    setNewScheduledAt(toLocalDateTimeInput(lesson.scheduled_at));
    setRescheduleTarget(lesson);
    policyMutation.mutate(lesson.id);
  };

  const closeReschedule = () => {
    if (rescheduleMutation.isPending) return;
    setRescheduleTarget(null);
    setNewScheduledAt("");
    setRescheduleValidationError(null);
    policyMutation.reset();
  };

  return (
    <main data-testid="my-lessons" className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 md:px-8">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">My Lessons</h1>

      {lessons.length === 0 ? (
        <EmptyState message="No lessons scheduled yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {lessons.map((lesson) => {
            const badge =
              statusBadgeClass[lesson.status] ??
              "bg-overlay/10 dark:bg-overlay-dark/10 text-muted dark:text-muted-dark";
            const label = statusLabel[lesson.status] ?? lesson.status;
            const location = locationLabel[lesson.location_type] ?? lesson.location_type;
            const note = noteMap.get(lesson.id);
            const isExpanded = expandedLessonId === lesson.id;

            return (
              <Card key={lesson.id}>
                <div data-testid="my-lesson-card">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-3">
                        <span className="font-semibold text-primary dark:text-primary-dark">
                          {formatDateTime(lesson.scheduled_at)}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge}`}>
                          {label}
                        </span>
                      </div>
                      <p className="text-sm text-muted dark:text-muted-dark">
                        {lesson.duration_minutes} min · {location}
                      </p>
                      {lesson.cancellation_reason ? (
                        <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">
                          Reason: {lesson.cancellation_reason}
                        </p>
                      ) : null}
                    </div>
                    {isFutureScheduledLesson(lesson) ? (
                      <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        <Button
                          variant="outline"
                          className="px-3 py-1.5 text-xs"
                          data-testid="reschedule-my-lesson"
                          onClick={() => openReschedule(lesson)}
                        >
                          Reschedule
                        </Button>
                        <Button
                          variant="danger"
                          className="px-3 py-1.5 text-xs"
                          data-testid="cancel-my-lesson"
                          onClick={() => openCancel(lesson)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : lesson.status === "completed" ? (
                      <Disclosure
                        isExpanded={isExpanded}
                        onExpandedChange={() => toggleExpand(lesson.id)}
                      >
                        <DisclosureTrigger
                          data-testid="toggle-notes"
                          className="shrink-0 rounded-lg px-3 py-1.5 text-xs text-violet-400 transition-colors hover:bg-overlay/5 hover:text-violet-300 data-[expanded]:text-violet-300 dark:hover:bg-overlay-dark/5"
                        >
                          {isExpanded ? "Hide Notes" : "View Notes"}
                        </DisclosureTrigger>
                        <DisclosurePanel>
                          {note ? (
                            <NoteSection note={note} />
                          ) : (
                            <div className="mt-4 border-t border-overlay/5 pt-4 dark:border-overlay-dark/5">
                              <p className="text-sm text-muted dark:text-muted-dark">
                                No notes for this lesson.
                              </p>
                            </div>
                          )}
                        </DisclosurePanel>
                      </Disclosure>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={cancelTarget !== null} onClose={closeCancel} title="Cancel Lesson">
        <form
          data-testid="cancel-my-lesson-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!cancelTarget || !policyMutation.data) return;
            const reason = cancellationReason.trim();
            cancelMutation.mutate({
              lessonId: cancelTarget.id,
              ...(reason ? { reason } : {}),
            });
          }}
        >
          {cancelTarget ? (
            <p className="text-sm text-muted dark:text-muted-dark">
              Cancel the lesson scheduled for {formatDateTime(cancelTarget.scheduled_at)}?
            </p>
          ) : null}

          {policyMutation.isPending ? (
            <p
              data-testid="cancellation-policy-loading"
              className="text-sm text-muted dark:text-muted-dark"
            >
              Loading the cancellation policy...
            </p>
          ) : null}
          {policyMutation.data ? <PolicySummary policy={policyMutation.data} /> : null}
          {policyMutation.isError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {getErrorMessage(policyMutation.error, "Unable to load the cancellation policy")}
            </p>
          ) : null}

          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted dark:text-muted-dark">
            Reason (optional)
            <textarea
              name="reason"
              data-testid="cancellation-reason"
              value={cancellationReason}
              maxLength={1000}
              rows={3}
              onChange={(event) => setCancellationReason(event.target.value)}
              className="resize-y rounded-lg border border-overlay/10 bg-card px-4 py-3 text-primary outline-hidden transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark"
            />
          </label>

          {cancelMutation.isError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {getErrorMessage(cancelMutation.error, "Unable to cancel this lesson")}
            </p>
          ) : null}

          <div className="flex justify-end gap-3 pt-1">
            <Button variant="ghost" onClick={closeCancel} disabled={cancelMutation.isPending}>
              Keep Lesson
            </Button>
            <Button
              type="submit"
              variant="danger"
              data-testid="confirm-cancel-my-lesson"
              disabled={!policyMutation.data || cancelMutation.isPending}
            >
              {cancelMutation.isPending ? "Cancelling..." : "Cancel Lesson"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={rescheduleTarget !== null} onClose={closeReschedule} title="Reschedule Lesson">
        <form
          data-testid="reschedule-my-lesson-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!rescheduleTarget) return;

            const parsedDate = new Date(newScheduledAt);
            if (!newScheduledAt || Number.isNaN(parsedDate.getTime()) || parsedDate <= new Date()) {
              setRescheduleValidationError("Choose a future date and time.");
              return;
            }

            setRescheduleValidationError(null);
            rescheduleMutation.mutate({
              lessonId: rescheduleTarget.id,
              scheduledAt: parsedDate,
            });
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted dark:text-muted-dark">
            New date and time
            <input
              type="datetime-local"
              name="new_scheduled_at"
              data-testid="new-lesson-date-time"
              required
              min={toLocalDateTimeInput(new Date())}
              value={newScheduledAt}
              onChange={(event) => {
                setNewScheduledAt(event.target.value);
                setRescheduleValidationError(null);
              }}
              className="rounded-lg border border-overlay/10 bg-card px-4 py-3 text-primary outline-hidden transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark"
            />
          </label>

          {rescheduleValidationError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {rescheduleValidationError}
            </p>
          ) : null}
          {policyMutation.isPending ? (
            <p className="text-sm text-muted dark:text-muted-dark">
              Loading the cancellation policy...
            </p>
          ) : null}
          {policyMutation.data ? <PolicySummary policy={policyMutation.data} /> : null}
          {policyMutation.isError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {getErrorMessage(policyMutation.error, "Unable to load the cancellation policy")}
            </p>
          ) : null}
          {rescheduleMutation.isError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {getErrorMessage(rescheduleMutation.error, "Unable to reschedule this lesson")}
            </p>
          ) : null}

          <div className="flex justify-end gap-3 pt-1">
            <Button
              variant="ghost"
              onClick={closeReschedule}
              disabled={rescheduleMutation.isPending}
            >
              Keep Current Time
            </Button>
            <Button
              type="submit"
              data-testid="confirm-reschedule-my-lesson"
              disabled={rescheduleMutation.isPending || !newScheduledAt}
            >
              {rescheduleMutation.isPending ? "Rescheduling..." : "Reschedule Lesson"}
            </Button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
