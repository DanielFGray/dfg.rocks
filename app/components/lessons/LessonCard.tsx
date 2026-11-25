import { Card } from "../ui/Card.js";
import { Button } from "../ui/Button.js";
import type { Lesson } from "../../../shared/schemas.js";
import { statusBadgeClass, statusLabel, locationLabel, formatDateTime } from "./helpers.js";

export function LessonCard({
  lesson,
  studentName,
  onNotes,
  onComplete,
  onCancel,
  onEdit,
  onDelete,
  completePending,
}: {
  lesson: Lesson;
  studentName: string;
  onNotes: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Disables the Complete control while the mutation runs, so one lesson cannot be completed twice. */
  completePending?: boolean;
}) {
  const badge = statusBadgeClass[lesson.status] ?? "bg-overlay/10 text-muted";
  const label = statusLabel[lesson.status] ?? lesson.status;
  const location = locationLabel[lesson.location_type] ?? lesson.location_type;

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-3">
            <span className="font-semibold text-primary">{studentName}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge}`}>
              {label}
            </span>
            {lesson.recurring_schedule_id ? (
              <span
                data-testid="recurring-lesson-badge"
                className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:text-violet-300"
              >
                Recurring
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted">
            {formatDateTime(lesson.scheduled_at)} · {lesson.duration_minutes} min · {location}
          </p>
          {lesson.cancellation_reason ? (
            <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">
              Reason: {lesson.cancellation_reason}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            onClick={onNotes}
            size="sm"
            tone="note"
            data-testid="lesson-notes"
          >
            Notes
          </Button>
          {lesson.status === "scheduled" ? (
            <>
              <Button
                variant="ghost"
                onClick={onEdit}
                size="sm"
                tone="info"
                data-testid="edit-lesson"
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                onClick={onComplete}
                size="sm"
                tone="success"
                disabled={completePending}
                data-testid="complete-lesson"
              >
                {completePending ? "Completing..." : "Complete"}
              </Button>
              <Button
                variant="ghost"
                onClick={onCancel}
                size="sm"
                tone="danger"
                data-testid="cancel-lesson"
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                onClick={onDelete}
                size="sm"
                tone="danger"
                data-testid="delete-lesson"
              >
                Delete
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
