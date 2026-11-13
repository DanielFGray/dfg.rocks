import { Effect } from "effect";
import { withAuthContext } from "../../../server/requestDatabase.js";
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
import { Students } from "../../../server/services/students.js";
import { Messages } from "../../../server/services/messages.js";
import { Materials } from "../../../server/services/materials.js";
import { Courses } from "../../../server/services/courses.js";
import { Testimonials } from "../../../server/services/testimonials.js";
import { TestimonialReminder } from "../../../server/services/testimonialReminder.js";
import { Sessions, resolveEffectiveStudent } from "../../../server/services/sessions.js";
import { Lessons } from "../../../server/services/lessons.js";
import { Practice } from "../../../server/services/practice.js";
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
      const session = yield* Sessions.use((sessionService) =>
        sessionService.validateSessionToken(token),
      );
      if (!session) throw new Error("Unauthorized");
      return yield* Effect.gen(function* () {
        const effective = resolveEffectiveStudent(session);
        const filterStudentId = effective.isActing ? effective.studentId : undefined;

        if (session.user.role === "admin") {
          const today = todayRange();
          const week = weekRange();
          const data = yield* Effect.all({
            students: Students.use((studentService) => studentService.listStudents()),
            messages: Messages.use((messageService) =>
              messageService.messages({
                limit: 50,
                offset: 0,
              }),
            ),
            todayLessons: Lessons.use((lessonService) =>
              lessonService.listLessons({
                limit: 50,
                offset: 0,
                from: today.from,
                to: today.to,
              }),
            ),
            weekLessons: Lessons.use((lessonService) =>
              lessonService.listLessons({
                limit: 50,
                offset: 0,
                from: week.from,
                to: week.to,
              }),
            ),
            courses: Courses.use((courseService) => courseService.listCourses()),
            submissions: Practice.use((practiceService) => practiceService.listSubmissions(5000, 0)),
            testimonials: Testimonials.use((testimonialService) =>
              testimonialService.listTestimonials(),
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
            courses: [...(yield* S.decodeEffect(S.Array(SharedSchemas.Course))(data.courses))],
            unreadSubmissions: data.submissions.filter((submission) => !submission.is_read),
            pendingTestimonials: data.testimonials
              .filter((testimonial) => !testimonial.is_approved)
              .map(serializeTestimonial),
          };
        }

        const [data, canShowTestimonialPrompt] = yield* Effect.all([
          Effect.all({
            messages: Messages.use((messageService) =>
              messageService.messages({ limit: 50, offset: 0 }, filterStudentId),
            ),
            assignments: Materials.use((materialService) =>
              materialService.assignments(filterStudentId),
            ),
            scheduledLessons: Lessons.use((lessonService) =>
              lessonService.myLessons(
                { status: "scheduled", limit: 5, offset: 0 },
                filterStudentId,
              ),
            ),
            courses: Courses.use((courseService) => courseService.courses(filterStudentId)),
            testimonial: Testimonials.use((testimonialService) =>
              testimonialService.testimonial(session.user.id),
            ),
          }),
          TestimonialReminder.use((testimonialReminderService) =>
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
          courses: [...(yield* S.decodeEffect(S.Array(SharedSchemas.Course))(data.courses))],
          testimonial: data.testimonial ? serializeTestimonial(data.testimonial) : null,
          canShowTestimonialPrompt,
        };
      }).pipe(withAuthContext(session.session.id));
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
          unreadSubmissions={data.unreadSubmissions}
          pendingTestimonials={data.pendingTestimonials}
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
