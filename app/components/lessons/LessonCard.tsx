import { Card } from "../ui/Card.js";
import { Button } from "../ui/Button.js";
import type { Lesson } from "../../lib/types.js";
import { statusBadgeClass, statusLabel, locationLabel, formatDateTime } from "./helpers.js";

export function LessonCard({ lesson, studentName, onNotes, onComplete, onCancel }: {
  lesson: Lesson;
  studentName: string;
  onNotes: () => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const badge = statusBadgeClass[lesson.status] ?? "bg-white/10 text-muted";
  const label = statusLabel[lesson.status] ?? lesson.status;
  const location = locationLabel[lesson.location_type] ?? lesson.location_type;

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span className="font-semibold text-primary">{studentName}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge}`}>
              {label}
            </span>
          </div>
          <p className="text-sm text-muted">
            {formatDateTime(lesson.scheduled_at)} · {lesson.duration_minutes} min · {location}
          </p>
          {lesson.cancellation_reason ? (
            <p className="text-xs text-red-400/80 mt-1">
              Reason: {lesson.cancellation_reason}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="ghost"
            onClick={onNotes}
            className="text-xs px-3 py-1.5 text-violet-400 hover:text-violet-300"
            data-pwid="lesson-notes"
          >
            Notes
          </Button>
          {lesson.status === "scheduled" ? (
            <>
              <Button
                variant="ghost"
                onClick={onComplete}
                className="text-xs px-3 py-1.5 text-green-400 hover:text-green-300"
                data-pwid="complete-lesson"
              >
                Complete
              </Button>
              <Button
                variant="ghost"
                onClick={onCancel}
                className="text-xs px-3 py-1.5 text-red-400 hover:text-red-300"
                data-pwid="cancel-lesson"
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
