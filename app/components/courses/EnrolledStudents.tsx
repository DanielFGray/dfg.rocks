import { Link } from "@tanstack/react-router";
import type { User } from "../../../shared/schemas.js";
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
    <section className="mt-10 border-t border-overlay/6 pt-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-primary">
          Enrolled Students
        </h2>
        {availableStudents.length > 0 ? (
          <Button
            variant="outline"
            onClick={onEnroll}
            data-testid="enroll-student-course"
            className="px-3 py-1.5 text-xs"
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
        <div className="flex flex-col gap-2">
          {enrolledStudents.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-lg border border-overlay/6 bg-card px-4 py-3 text-sm"
            >
              <div>
                <Link
                  to="/people/$id"
                  params={{ id: s.id }}
                  className="font-semibold text-primary no-underline transition-colors hover:text-accent"
                >
                  {s.name}
                </Link>
                <span className="ml-3 text-xs text-muted">@{s.username}</span>
              </div>
              <Button
                variant="ghost"
                onClick={() => onUnenroll(s)}
                className="text-xs text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
              >
                Unenroll
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
