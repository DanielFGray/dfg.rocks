import { Link } from "@tanstack/react-router";
import type { User } from "../../lib/types.js";
import { Button } from "../ui/Button.js";
import { EmptyState } from "../ui/EmptyState.js";

export function EnrolledStudents({
  enrolledStudents,
  availableStudents,
  onEnroll,
  onUnenroll,
}: {
  enrolledStudents: User[];
  availableStudents: User[];
  onEnroll: () => void;
  onUnenroll: (student: User) => void;
}) {
  return (
    <section className="mt-10 pt-8 border-overlay/6 dark:border-overlay-dark/6 border-t">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-primary dark:text-primary-dark">
          Enrolled Students
        </h2>
        {availableStudents.length > 0 ? (
          <Button
            variant="outline"
            onClick={onEnroll}
            data-testid="enroll-student-course"
            className="text-xs px-3 py-1.5"
          >
            + Enroll Student
          </Button>
        ) : null}
      </div>
      {enrolledStudents.length === 0 ? (
        <EmptyState
          message="No students enrolled."
          action={
            availableStudents.length > 0
              ? { label: "Enroll Student", onClick: onEnroll }
              : undefined
          }
        />
      ) : (
        <div className="gap-2 flex flex-col">
          {enrolledStudents.map((s) => (
            <div
              key={s.id}
              className="rounded-lg bg-card dark:bg-card-dark border-overlay/6 dark:border-overlay-dark/6 px-4 py-3 text-sm flex items-center justify-between border"
            >
              <div>
                <Link
                  to="/students/$id"
                  params={{ id: s.id }}
                  className="font-semibold text-primary dark:text-primary-dark hover:text-accent no-underline transition-colors"
                >
                  {s.name}
                </Link>
                <span className="text-muted dark:text-muted-dark text-xs ml-3">@{s.username}</span>
              </div>
              <button
                type="button"
                onClick={() => onUnenroll(s)}
                className="text-xs text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300 cursor-pointer transition-colors"
              >
                Unenroll
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
