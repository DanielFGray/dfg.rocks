import { Effect } from "effect";
import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { getDashboardPageData } from "../../lib/routeData.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { AdminDashboard } from "../../components/dashboard/AdminDashboard.js";
import { StudentDashboard } from "../../components/dashboard/StudentDashboard.js";

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard | DFG Portal" }] }),
  loader: () => getDashboardPageData(),
  component: DashboardPage,
  pendingComponent: () => <div>Loading...</div>,
});

/* ---------------------------------------------------------------------------
 * DashboardPage — branches between admin and student views
 * --------------------------------------------------------------------------- */

function EmailVerificationBanner() {
  const [sent, setSent] = useState(false);
  const resend = useMutation({
    mutationFn: () => Effect.runPromise(api.auth.resendVerification()),
    onSuccess: () => setSent(true),
  });

  return (
    <div
      data-testid="verify-email-banner"
      className="mb-6 gap-4 rounded-lg border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center justify-between border"
    >
      <p className="text-sm text-amber-200">
        Verify your email address to receive lesson reminders and updates.
      </p>
      {sent ? (
        <span className="text-sm text-amber-300 shrink-0">
          Verification email sent
        </span>
      ) : (
        <button
          type="button"
          onClick={() => resend.mutate()}
          disabled={resend.isPending}
          data-testid="resend-verification"
          className="rounded-md bg-amber-500/20 px-3 py-1.5 text-sm font-medium text-amber-200 hover:bg-amber-500/30 shrink-0 transition-colors disabled:opacity-50"
        >
          {resend.isPending ? "Sending..." : "Resend verification email"}
        </button>
      )}
    </div>
  );
}

function DashboardPage() {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const data = Route.useLoaderData();

  return (
    <main
      data-testid="dashboard"
      className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]"
    >
      {user && !user.is_verified ? <EmailVerificationBanner /> : null}
      {isAdmin && data.kind === "admin" ? (
        <AdminDashboard
          todayLessons={data.todayLessons}
          weekLessons={data.weekLessons}
          messages={data.messages}
          students={data.students}
          courses={data.courses}
        />
      ) : (
        <StudentDashboard
          messages={data.kind === "student" ? data.messages : []}
          lessons={data.kind === "student" ? data.scheduledLessons : []}
          assignments={data.kind === "student" ? data.assignments : []}
          courses={data.kind === "student" ? data.courses : []}
          testimonial={data.kind === "student" ? data.testimonial : null}
          canShowTestimonialPrompt={
            data.kind === "student" ? data.canShowTestimonialPrompt : false
          }
          onRefresh={() => void router.invalidate()}
        />
      )}
    </main>
  );
}
