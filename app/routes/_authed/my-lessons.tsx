import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { Lesson, LessonNote } from "../../lib/types.js";
import { Card } from "../../components/ui/Card.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

const myLessonsQuery = queryOptions({
  queryKey: ["my-lessons"],
  queryFn: async () => {
    const { data, error } = await api["my-lessons"].get();
    if (error) throw error;
    return data;
  },
});

const myLessonNotesQuery = queryOptions({
  queryKey: ["my-lesson-notes"],
  queryFn: async () => {
    const { data, error } = await api["my-lesson-notes"].get({ query: { limit: 100 } });
    if (error) throw error;
    return data;
  },
});

export const Route = createFileRoute("/_authed/my-lessons")({
  loader: async ({ context: { queryClient } }) => {
    await Promise.allSettled([
      queryClient.ensureQueryData(myLessonsQuery),
      queryClient.ensureQueryData(myLessonNotesQuery),
    ]);
  },
  head: () => ({ meta: [{ title: "My Lessons | DFG Portal" }] }),
  component: MyLessonsPage,
  pendingComponent: () => (
    <main className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16 text-muted">Loading...</main>
  ),
});

/* ---------------------------------------------------------------------------
 * Constants
 * --------------------------------------------------------------------------- */

const statusBadgeClass: Record<string, string> = {
  scheduled: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  cancelled: "bg-red-500/20 text-red-400",
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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ---------------------------------------------------------------------------
 * NoteSection — render fields that have content
 * --------------------------------------------------------------------------- */

function NoteSection({ note }: { note: LessonNote }) {
  const hasContent = note.topics_covered || note.homework || note.progress_observations || note.notes;

  if (!hasContent) {
    return (
      <div className="mt-4 pt-4 border-t border-white/5">
        <p className="text-sm text-muted">No details in this note.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-white/5 flex flex-col gap-3">
      {note.topics_covered ? (
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Topics Covered</p>
          <p className="text-sm text-primary">{note.topics_covered}</p>
        </div>
      ) : null}
      {note.homework ? (
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Homework</p>
          <p className="text-sm text-primary">{note.homework}</p>
        </div>
      ) : null}
      {note.progress_observations ? (
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Progress</p>
          <p className="text-sm text-primary">{note.progress_observations}</p>
        </div>
      ) : null}
      {note.notes ? (
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Notes</p>
          <p className="text-sm text-primary">{note.notes}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * MyLessonsPage
 * --------------------------------------------------------------------------- */

function MyLessonsPage() {
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);

  const { data: lessons } = useSuspenseQuery(myLessonsQuery);

  const { data: notes } = useSuspenseQuery(myLessonNotesQuery);

  // Build note lookup by lesson_id
  const noteMap = new Map<string, LessonNote>();
  (notes as LessonNote[]).forEach((n) => {
    noteMap.set(n.lesson_id, n);
  });

  const toggleExpand = (id: string) => {
    setExpandedLessonId((prev) => (prev === id ? null : id));
  };

  return (
    <main data-pwid="my-lessons" className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16">
      <h1 className="text-3xl font-bold tracking-tight mb-8">My Lessons</h1>

      {lessons.length === 0 ? (
        <EmptyState message="No lessons scheduled yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {(lessons as Lesson[]).map((lesson) => {
            const badge = statusBadgeClass[lesson.status] ?? "bg-white/10 text-muted";
            const label = statusLabel[lesson.status] ?? lesson.status;
            const location = locationLabel[lesson.location_type] ?? lesson.location_type;
            const note = noteMap.get(lesson.id);
            const isExpanded = expandedLessonId === lesson.id;

            return (
              <Card key={lesson.id}>
                <div data-pwid="my-lesson-card">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-semibold text-primary">
                          {formatDateTime(lesson.scheduled_at)}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge}`}>
                          {label}
                        </span>
                      </div>
                      <p className="text-sm text-muted">
                        {lesson.duration_minutes} min · {location}
                      </p>
                      {lesson.cancellation_reason ? (
                        <p className="text-xs text-red-400/80 mt-1">
                          Reason: {lesson.cancellation_reason}
                        </p>
                      ) : null}
                    </div>
                    {lesson.status === "completed" ? (
                      <button
                        type="button"
                        onClick={() => toggleExpand(lesson.id)}
                        className="shrink-0 text-xs px-3 py-1.5 rounded-lg text-violet-400 hover:text-violet-300 hover:bg-white/5 transition-colors cursor-pointer"
                        data-pwid="toggle-notes"
                      >
                        {isExpanded ? "Hide Notes" : "View Notes"}
                      </button>
                    ) : null}
                  </div>

                  {isExpanded ? (
                    note ? (
                      <NoteSection note={note} />
                    ) : (
                      <div className="mt-4 pt-4 border-t border-white/5">
                        <p className="text-sm text-muted">No notes for this lesson.</p>
                      </div>
                    )
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
