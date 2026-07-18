import { useRouter } from "@tanstack/react-router";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { useSwitchActiveStudent } from "../../lib/queries.js";

export function ParentDashboard() {
  const { user, familyStudents, activeStudentId } = useAuth();
  const switchStudent = useSwitchActiveStudent();
  const router = useRouter();

  const firstName = user?.name ? user.name.split(" ")[0] : null;

  const handleSwitch = (studentId: string) => {
    switchStudent.mutate(studentId, {
      onSuccess: () => {
        router.invalidate();
      },
    });
  };

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">
        {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
      </h1>
      <p className="text-muted dark:text-muted-dark">
        Select a student below to view their dashboard, assignments, and
        lessons.
      </p>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">Your Students</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {familyStudents.map((student) => {
            const isActive = student.id === (activeStudentId ?? user?.id);
            return (
              <Card key={student.id} data-testid={`student-card-${student.id}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-primary dark:text-primary-dark">
                      {student.name ?? student.username}
                    </p>
                    <p className="text-sm text-muted dark:text-muted-dark">
                      @{student.username}
                    </p>
                  </div>
                  <Button
                    variant={isActive ? "outline" : "primary"}
                    onClick={() => handleSwitch(student.id)}
                    disabled={switchStudent.isPending}
                    data-testid={`switch-to-${student.id}`}
                  >
                    {switchStudent.isPending
                      ? "Switching..."
                      : isActive
                        ? "Current"
                        : "View"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
