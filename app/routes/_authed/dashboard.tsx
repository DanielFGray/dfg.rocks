import { Effect } from "effect";
import * as S from "effect/Schema";
import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { AdminDashboard } from "../../components/dashboard/AdminDashboard.js";
import { StudentDashboard } from "../../components/dashboard/StudentDashboard.js";
import { ParentOnboarding } from "../../components/dashboard/ParentOnboarding.js";
import { ParentDashboard } from "../../components/dashboard/ParentDashboard.js";
import { serverRuntime } from "../../../server/runtime.js";
import { AdminRouteService } from "../../../server/services/adminRouteService.js";
import { TestimonialReminderService } from "../../../server/services/testimonialReminderService.js";
import { SessionService } from "../../../server/services/sessionService.js";
import { AuthenticatedRouteService } from "../../../server/services/authenticatedRouteService.js";
import * as SharedSchemas from "../../../shared/schemas.js";
import {
  serializeMessage,
  serializeMaterial,
  serializeLesson,
  serializeTestimonial,
  normalizeStudents,
} from "../../../shared/responseMappers.js";
import { todayRange, weekRange } from "../../../shared/dateRanges.js";
import { toServerFunctionPayload } from "../../lib/serverFunctionPayload.js";

const getDashboardPageData = createServerFn({ method: "GET" }).handler(() =>
  serverRuntime.runPromise(
    Effect.gen(function* () {
      const token = yield* Effect.sync(() => getCookie("session"));
      const session = yield* SessionService.use((sessionService) =>
        sessionService.validateSessionToken(token),
      );
      if (!session) throw new Error("Unauthorized");

      const effectiveStudentId =
        session.user.role === "parent" && session.session.active_student_id
          ? session.session.active_student_id
          : null;
      const isActing = effectiveStudentId !== null;
      const filterStudentId = isActing ? effectiveStudentId : undefined;

      if (session.user.role === "admin") {
        const today = todayRange();
        const week = weekRange();
        const data = yield* Effect.all({
          students: AdminRouteService.use((adminRouteService) =>
            adminRouteService.listStudents(session.session.id),
          ),
          messages: AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.messages(session.session.id, {
              limit: 50,
              offset: 0,
            }),
          ),
          todayLessons: AdminRouteService.use((adminRouteService) =>
            adminRouteService.listLessons(session.session.id, {
              limit: 50,
              offset: 0,
              from: today.from,
              to: today.to,
            }),
          ),
          weekLessons: AdminRouteService.use((adminRouteService) =>
            adminRouteService.listLessons(session.session.id, {
              limit: 50,
              offset: 0,
              from: week.from,
              to: week.to,
            }),
          ),
          courses: AdminRouteService.use((adminRouteService) =>
            adminRouteService.listCourses(session.session.id),
          ),
        });

        // Explicitly type the arrays to fix inference
        const messagesArray = data.messages as ReadonlyArray<{
          id: string;
          sender_id: string;
          recipient_id: string;
          body: string;
          is_read: boolean;
          created_at: Date | string;
        }>;
        const lessonsArray = data.todayLessons as ReadonlyArray<{
          id: string;
          student_id: string;
          gcal_event_id: string | null;
          scheduled_at: Date | string;
          duration_minutes: number;
          location_type: "in_person_student_travels" | "in_person_teacher_travels" | "online" | "studio";
          status: "scheduled" | "completed" | "cancelled" | "no_show";
          cancellation_reason: string | null;
          cancelled_at: Date | string | null;
          completed_at: Date | string | null;
          cancellation_fee_cents: number;
          remainder_due_cents: number;
          created_at: Date | string;
        }>;
        const adminMessages: ReturnType<typeof serializeMessage>[] = messagesArray.map(serializeMessage);
        const adminTodayLessons: ReturnType<typeof serializeLesson>[] = lessonsArray.map(serializeLesson);
        const adminWeekLessons: ReturnType<typeof serializeLesson>[] = data.weekLessons.map(serializeLesson);
        return toServerFunctionPayload({
          kind: "admin" as const,
          students: normalizeStudents(data.students),
          messages: adminMessages,
          todayLessons: adminTodayLessons,
          weekLessons: adminWeekLessons,
          courses: [...S.decodeUnknownSync(S.Array(SharedSchemas.Course))(data.courses)],
        });
      }

      const [data, canShowTestimonialPrompt] = yield* Effect.all([
        Effect.all({
          messages: AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.messages(
              session.session.id,
              { limit: 50, offset: 0 },
              filterStudentId,
            ),
          ),
          assignments: AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.assignments(session.session.id, filterStudentId),
          ),
          scheduledLessons: AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.myLessons(
              session.session.id,
              { status: "scheduled", limit: 5, offset: 0 },
              filterStudentId,
            ),
          ),
          courses: AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.courses(session.session.id, filterStudentId),
          ),
          testimonial: AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.testimonial(session.session.id, session.user.id),
          ),
        }),
        TestimonialReminderService.use((testimonialReminderService) =>
          testimonialReminderService.getPromptEnabled(session.user.id),
        ),
      ]);

      // Explicitly type the arrays to fix inference
      const messagesArray = data.messages as ReadonlyArray<{
        id: string;
        sender_id: string;
        recipient_id: string;
        body: string;
        is_read: boolean;
        created_at: Date | string;
      }>;
      const assignmentsArray = data.assignments as ReadonlyArray<{
        id: string;
        title: string;
        original_filename: string;
        mime_type: string;
        file_size: number;
        is_global: boolean;
        notation_tracks: unknown;
        assigned_track_index: number | null;
      }>;
      const scheduledLessonsArray = data.scheduledLessons as ReadonlyArray<{
        id: string;
        student_id: string;
        gcal_event_id: string | null;
        scheduled_at: Date | string;
        duration_minutes: number;
        location_type: "in_person_student_travels" | "in_person_teacher_travels" | "online" | "studio";
        status: "scheduled" | "completed" | "cancelled" | "no_show";
        cancellation_reason: string | null;
        cancelled_at: Date | string | null;
        completed_at: Date | string | null;
        cancellation_fee_cents: number;
        remainder_due_cents: number;
        created_at: Date | string;
      }>;
      const studentMessages: ReturnType<typeof serializeMessage>[] = messagesArray.map(serializeMessage);
      const studentAssignments: ReturnType<typeof serializeMaterial>[] = assignmentsArray.map(serializeMaterial);
      const studentScheduledLessons: ReturnType<typeof serializeLesson>[] = scheduledLessonsArray.map(serializeLesson);
      return toServerFunctionPayload({
        kind: "student" as const,
        messages: studentMessages,
        assignments: studentAssignments,
        scheduledLessons: studentScheduledLessons,
        courses: [...S.decodeUnknownSync(S.Array(SharedSchemas.Course))(data.courses)],
        testimonial: data.testimonial ? serializeTestimonial(data.testimonial) : null,
        canShowTestimonialPrompt,
      });
    }),
  ),
);

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard | DFG Portal" }] }),
  staleTime: 5_000,
  validateSearch: () => ({}),
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
      className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3"
    >
      <p className="text-sm text-amber-200">
        Verify your email address to receive lesson reminders and updates.
      </p>
      {sent ? (
        <span className="shrink-0 text-sm text-amber-300">Verification email sent</span>
      ) : (
        <button
          type="button"
          onClick={() => resend.mutate()}
          disabled={resend.isPending}
          data-testid="resend-verification"
          className="shrink-0 rounded-md bg-amber-500/20 px-3 py-1.5 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
        >
          {resend.isPending ? "Sending..." : "Resend verification email"}
        </button>
      )}
    </div>
  );
}

function DashboardPage() {
  const router = useRouter();
  const { user, isAdmin, isParent, familyStudents, activeStudentId } = useAuth();
  const data = Route.useLoaderData();

  const showParentOnboarding = isParent && familyStudents.length === 0;

  return (
    <main data-testid="dashboard" className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 md:px-8">
      {user && !user.is_verified ? <EmailVerificationBanner /> : null}
      {isAdmin && data.kind === "admin" ? (
        <AdminDashboard
          todayLessons={data.todayLessons}
          weekLessons={data.weekLessons}
          messages={data.messages}
          students={data.students}
          courses={data.courses}
        />
      ) : showParentOnboarding ? (
        <ParentOnboarding isFirstStudent={true} onSuccess={() => router.invalidate()} />
      ) : isParent && familyStudents.length > 0 && !activeStudentId ? (
        <ParentDashboard />
      ) : (
        <StudentDashboard
          messages={data.kind === "student" ? data.messages : []}
          lessons={data.kind === "student" ? data.scheduledLessons : []}
          assignments={data.kind === "student" ? data.assignments : []}
          courses={data.kind === "student" ? data.courses : []}
          testimonial={data.kind === "student" ? data.testimonial : null}
          canShowTestimonialPrompt={data.kind === "student" ? data.canShowTestimonialPrompt : false}
          onRefresh={() => router.invalidate()}
        />
      )}
    </main>
  );
}
