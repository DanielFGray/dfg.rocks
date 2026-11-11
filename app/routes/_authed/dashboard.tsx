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
import { runServerEffect } from "../../lib/serverEffect.js";
import { AdminRouteService } from "../../../server/services/adminRouteService.js";
import { MessageService } from "../../../server/services/messageService.js";
import { MaterialService } from "../../../server/services/materialService.js";
import { CourseService } from "../../../server/services/courseService.js";
import { TestimonialService } from "../../../server/services/testimonialService.js";
import { TestimonialReminderService } from "../../../server/services/testimonialReminderService.js";
import {
  SessionService,
  resolveEffectiveStudent,
} from "../../../server/services/sessionService.js";
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

const getDashboardPageData = createServerFn({ method: "GET" }).handler(() =>
  runServerEffect(
    Effect.gen(function* () {
      const token = yield* Effect.sync(() => getCookie("session"));
      const session = yield* SessionService.use((sessionService) =>
        sessionService.validateSessionToken(token),
      );
      if (!session) throw new Error("Unauthorized");

      const effective = resolveEffectiveStudent(session);
      const filterStudentId = effective.isActing ? effective.studentId : undefined;

      if (session.user.role === "admin") {
        const today = todayRange();
        const week = weekRange();
        const data = yield* Effect.all({
          students: AdminRouteService.use((adminRouteService) =>
            adminRouteService.listStudents(session.session.id),
          ),
          messages: MessageService.use((messageService) =>
            messageService.messages(session.session.id, {
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
          courses: CourseService.use((courseService) =>
            courseService.listCourses(session.session.id),
          ),
        });
        const adminMessages: ReturnType<typeof serializeMessage>[] =
          data.messages.map(serializeMessage);
        const adminTodayLessons: ReturnType<typeof serializeLesson>[] =
          data.todayLessons.map(serializeLesson);
        const adminWeekLessons: ReturnType<typeof serializeLesson>[] =
          data.weekLessons.map(serializeLesson);
        return {
          kind: "admin" as const,
          students: normalizeStudents(data.students),
          messages: adminMessages,
          todayLessons: adminTodayLessons,
          weekLessons: adminWeekLessons,
          courses: [...S.decodeUnknownSync(S.Array(SharedSchemas.Course))(data.courses)],
        };
      }

      const [data, canShowTestimonialPrompt] = yield* Effect.all([
        Effect.all({
          messages: MessageService.use((messageService) =>
            messageService.messages(session.session.id, { limit: 50, offset: 0 }, filterStudentId),
          ),
          assignments: MaterialService.use((materialService) =>
            materialService.assignments(session.session.id, filterStudentId),
          ),
          scheduledLessons: AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.myLessons(
              session.session.id,
              { status: "scheduled", limit: 5, offset: 0 },
              filterStudentId,
            ),
          ),
          courses: CourseService.use((courseService) =>
            courseService.courses(session.session.id, filterStudentId),
          ),
          testimonial: TestimonialService.use((testimonialService) =>
            testimonialService.testimonial(session.session.id, session.user.id),
          ),
        }),
        TestimonialReminderService.use((testimonialReminderService) =>
          testimonialReminderService.getPromptEnabled(session.user.id),
        ),
      ]);
      const studentMessages: ReturnType<typeof serializeMessage>[] =
        data.messages.map(serializeMessage);
      const studentAssignments: ReturnType<typeof serializeMaterial>[] =
        data.assignments.map(serializeMaterial);
      const studentScheduledLessons: ReturnType<typeof serializeLesson>[] =
        data.scheduledLessons.map(serializeLesson);
      return {
        kind: "student" as const,
        messages: studentMessages,
        assignments: studentAssignments,
        scheduledLessons: studentScheduledLessons,
        courses: [...S.decodeUnknownSync(S.Array(SharedSchemas.Course))(data.courses)],
        testimonial: data.testimonial ? serializeTestimonial(data.testimonial) : null,
        canShowTestimonialPrompt,
      };
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
