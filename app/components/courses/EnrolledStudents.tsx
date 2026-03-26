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
    <section className="mt-10 pt-8 border-t border-white/[0.06]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-primary">
          Enrolled Students
        </h2>
        {availableStudents.length > 0 ? (
          <Button
            variant="outline"
            onClick={onEnroll}
            data-pwid="enroll-student-course"
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
        <div className="flex flex-col gap-2">
          {enrolledStudents.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-lg bg-card border border-white/[0.06] px-4 py-3 text-sm"
            >
              <div>
                <Link
                  to="/students/$id"
                  params={{ id: s.id }}
                  className="font-semibold text-primary no-underline hover:text-accent transition-colors"
                >
                  {s.name}
                </Link>
                <span className="text-muted text-xs ml-3">
                  @{s.username}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onUnenroll(s)}
                className="text-xs text-red-400 hover:text-red-300 transition-colors cursor-pointer"
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
