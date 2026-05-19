import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { Lesson, LessonNote } from "../../lib/types.js";
import { getMyLessonsPageData } from "../../lib/routeData.js";
import { Card } from "../../components/ui/Card.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

export const Route = createFileRoute("/_authed/my-lessons")({
  loader: () => getMyLessonsPageData(),
  head: () => ({ meta: [{ title: "My Lessons | DFG Portal" }] }),
  component: MyLessonsPage,
  pendingComponent: () => (
    <main className="px-5 md:px-8 pt-20 pb-16 text-muted dark:text-muted-dark mx-auto max-w-[1100px]">
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
  const hasContent =
    note.topics_covered || note.homework || note.progress_observations || note.notes;

  if (!hasContent) {
    return (
      <div className="mt-4 pt-4 border-overlay/5 dark:border-overlay-dark/5 border-t">
        <p className="text-sm text-muted dark:text-muted-dark">No details in this note.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-overlay/5 dark:border-overlay-dark/5 gap-3 flex flex-col border-t">
      {note.topics_covered ? (
        <div>
          <p className="text-xs font-semibold text-muted dark:text-muted-dark tracking-wider mb-1 uppercase">
            Topics Covered
          </p>
          <p className="text-sm text-primary dark:text-primary-dark">{note.topics_covered}</p>
        </div>
      ) : null}
      {note.homework ? (
        <div>
          <p className="text-xs font-semibold text-muted dark:text-muted-dark tracking-wider mb-1 uppercase">
            Homework
          </p>
          <p className="text-sm text-primary dark:text-primary-dark">{note.homework}</p>
        </div>
      ) : null}
      {note.progress_observations ? (
        <div>
          <p className="text-xs font-semibold text-muted dark:text-muted-dark tracking-wider mb-1 uppercase">
            Progress
          </p>
          <p className="text-sm text-primary dark:text-primary-dark">
            {note.progress_observations}
          </p>
        </div>
      ) : null}
      {note.notes ? (
        <div>
          <p className="text-xs font-semibold text-muted dark:text-muted-dark tracking-wider mb-1 uppercase">
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
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const { lessons, notes } = Route.useLoaderData();

  // Build note lookup by lesson_id
  const noteMap = new Map<string, LessonNote>();
  notes.forEach((n) => {
    noteMap.set(n.lesson_id, n);
  });

  const toggleExpand = (id: string) => {
    setExpandedLessonId((prev) => (prev === id ? null : id));
  };

  return (
    <main data-testid="my-lessons" className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]">
      <h1 className="text-3xl font-bold tracking-tight mb-8">My Lessons</h1>

      {lessons.length === 0 ? (
        <EmptyState message="No lessons scheduled yet." />
      ) : (
        <div className="gap-3 flex flex-col">
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
                  <div className="gap-4 flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="gap-3 mb-1 flex items-center">
                        <span className="font-semibold text-primary dark:text-primary-dark">
                          {formatDateTime(lesson.scheduled_at)}
                        </span>
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${badge}`}>
                          {label}
                        </span>
                      </div>
                      <p className="text-sm text-muted dark:text-muted-dark">
                        {lesson.duration_minutes} min · {location}
                      </p>
                      {lesson.cancellation_reason ? (
                        <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">
                          Reason: {lesson.cancellation_reason}
                        </p>
                      ) : null}
                    </div>
                    {lesson.status === "completed" ? (
                      <button
                        type="button"
                        onClick={() => toggleExpand(lesson.id)}
                        className="text-xs px-3 py-1.5 rounded-lg text-violet-400 hover:text-violet-300 hover:bg-overlay/5 dark:hover:bg-overlay-dark/5 shrink-0 cursor-pointer transition-colors"
                        data-testid="toggle-notes"
                      >
                        {isExpanded ? "Hide Notes" : "View Notes"}
                      </button>
                    ) : null}
                  </div>

                  {isExpanded ? (
                    note ? (
                      <NoteSection note={note} />
                    ) : (
                      <div className="mt-4 pt-4 border-overlay/5 dark:border-overlay-dark/5 border-t">
                        <p className="text-sm text-muted dark:text-muted-dark">
                          No notes for this lesson.
                        </p>
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
