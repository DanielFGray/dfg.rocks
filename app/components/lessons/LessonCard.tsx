import { Card } from "../ui/Card.js";
import { Button } from "../ui/Button.js";
import type { Lesson } from "../../lib/types.js";
import { statusBadgeClass, statusLabel, locationLabel, formatDateTime } from "./helpers.js";

export function LessonCard({
  lesson,
  studentName,
  onNotes,
  onComplete,
  onCancel,
}: {
  lesson: Lesson;
  studentName: string;
  onNotes: () => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const badge =
    statusBadgeClass[lesson.status] ??
    "bg-overlay/10 dark:bg-overlay-dark/10 text-muted dark:text-muted-dark";
  const label = statusLabel[lesson.status] ?? lesson.status;
  const location = locationLabel[lesson.location_type] ?? lesson.location_type;

  return (
    <Card>
      <div className="gap-4 flex items-start justify-between">
        <div className="min-w-0">
          <div className="gap-3 mb-1 flex items-center">
            <span className="font-semibold text-primary dark:text-primary-dark">{studentName}</span>
            <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${badge}`}>
              {label}
            </span>
          </div>
          <p className="text-sm text-muted dark:text-muted-dark">
            {formatDateTime(lesson.scheduled_at)} · {lesson.duration_minutes} min · {location}
          </p>
          {lesson.cancellation_reason ? (
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">
              Reason: {lesson.cancellation_reason}
            </p>
          ) : null}
        </div>
        <div className="gap-2 flex shrink-0">
          <Button
            variant="ghost"
            onClick={onNotes}
            className="text-xs px-3 py-1.5 text-violet-400 hover:text-violet-300"
            data-testid="lesson-notes"
          >
            Notes
          </Button>
          {lesson.status === "scheduled" ? (
            <>
              <Button
                variant="ghost"
                onClick={onComplete}
                className="text-xs px-3 py-1.5 text-green-400 hover:text-green-300"
                data-testid="complete-lesson"
              >
                Complete
              </Button>
              <Button
                variant="ghost"
                onClick={onCancel}
                className="text-xs px-3 py-1.5 text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
                data-testid="cancel-lesson"
              >
                Cancel
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
