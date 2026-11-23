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
}: {
  lesson: Lesson;
  studentName: string;
  onNotes: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const badge =
    statusBadgeClass[lesson.status] ??
    "bg-overlay/10 text-muted";
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
            className="px-3 py-1.5 text-xs text-violet-400 hover:text-violet-300"
            data-testid="lesson-notes"
          >
            Notes
          </Button>
          {lesson.status === "scheduled" ? (
            <>
              <Button
                variant="ghost"
                onClick={onEdit}
                className="px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300"
                data-testid="edit-lesson"
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                onClick={onComplete}
                className="px-3 py-1.5 text-xs text-green-400 hover:text-green-300"
                data-testid="complete-lesson"
              >
                Complete
              </Button>
              <Button
                variant="ghost"
                onClick={onCancel}
                className="px-3 py-1.5 text-xs text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
                data-testid="cancel-lesson"
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                onClick={onDelete}
                className="px-3 py-1.5 text-xs text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
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
