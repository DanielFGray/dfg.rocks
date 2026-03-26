import { createFileRoute } from "@tanstack/react-router";
import {
  adminTodayLessonsQuery,
  adminWeekLessonsQuery,
  adminStudentsQuery,
  adminCoursesQuery,
  messagesQuery,
  scheduledLessonsQuery,
  assignmentsQuery,
  coursesQuery,
} from "../../lib/queries.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { AdminDashboard } from "../../components/dashboard/AdminDashboard.js";
import { StudentDashboard } from "../../components/dashboard/StudentDashboard.js";

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard | DFG Portal" }] }),
  loader: async ({ context: { queryClient, isAdmin } }) => {
    if (isAdmin) {
      await Promise.allSettled([
        queryClient.ensureQueryData(adminTodayLessonsQuery()),
        queryClient.ensureQueryData(adminWeekLessonsQuery()),
        queryClient.ensureQueryData(messagesQuery),
        queryClient.ensureQueryData(adminStudentsQuery),
        queryClient.ensureQueryData(adminCoursesQuery),
      ]);
    } else {
      await Promise.allSettled([
        queryClient.ensureQueryData(scheduledLessonsQuery),
        queryClient.ensureQueryData(assignmentsQuery),
        queryClient.ensureQueryData(coursesQuery),
        queryClient.ensureQueryData(messagesQuery),
      ]);
    }
  },
  component: DashboardPage,
  pendingComponent: () => <div>Loading...</div>,
});

/* ---------------------------------------------------------------------------
 * DashboardPage — branches between admin and student views
 * --------------------------------------------------------------------------- */

function DashboardPage() {
  const { isAdmin } = useAuth();

  return (
    <main
      data-pwid="dashboard"
      className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16"
    >
      {isAdmin ? <AdminDashboard /> : <StudentDashboard />}
    </main>
  );
}
