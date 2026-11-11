import { Effect } from "effect";
import { queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./api.js";
import { decodeAuthState, getAuthUser, type AuthState } from "./auth.js";
import { todayRange, weekRange } from "../../shared/dateRanges.js";

// The server function returns JSON text; the cache holds the decoded state, so code that reads
// the cache directly (getQueryData) gets the same AuthState that useQuery does.
export const authUserQuery = queryOptions({
  queryKey: ["auth", "user"],
  queryFn: async () => decodeAuthState(await getAuthUser()),
  staleTime: 5_000,
});

export function fetchAuthUser(queryClient: QueryClient): Promise<AuthState> {
  return queryClient.ensureQueryData(authUserQuery);
}

/**
 * Get the effective student ID for query keys.
 * Returns the active student ID for parents, or undefined for self-acting users.
 * Uses the cached auth state to avoid additional queries.
 */
export function getEffectiveStudentId(queryClient: QueryClient): string | undefined {
  const cached = queryClient.getQueryData(authUserQuery.queryKey);
  if (!cached) return undefined;
  if (cached.isParent && cached.activeStudentId) {
    return cached.activeStudentId;
  }
  return undefined;
}

/**
 * Invalidate all queries that depend on the active student identity.
 * Call this after switching active student to ensure fresh data for the new student.
 */
export function invalidateStudentQueries(queryClient: QueryClient, studentId?: string) {
  const prefix = studentId ? ["messages", studentId] : ["messages"];
  queryClient.invalidateQueries({ queryKey: prefix, exact: false });

  if (studentId) {
    queryClient.invalidateQueries({ queryKey: ["assignments", studentId] });
    queryClient.invalidateQueries({ queryKey: ["practice-logs", studentId] });
    queryClient.invalidateQueries({ queryKey: ["courses", studentId] });
    queryClient.invalidateQueries({ queryKey: ["my-lessons", "scheduled", studentId] });
    queryClient.invalidateQueries({ queryKey: ["my-lessons", studentId] });
    queryClient.invalidateQueries({ queryKey: ["my-lesson-notes", studentId] });
    // available-slots uses date as second param, so invalidate all dates for this student
    queryClient.invalidateQueries({ queryKey: ["available-slots"], exact: false, predicate: (query) => {
      const key = query.queryKey;
      return key[0] === "available-slots" && key[2] === studentId;
    }});
  } else {
    // Invalidate all student-scoped variants
    queryClient.invalidateQueries({ queryKey: ["assignments"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["practice-logs"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["courses"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["my-lessons", "scheduled"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["my-lessons"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["my-lesson-notes"], exact: false });
    queryClient.invalidateQueries({ queryKey: ["available-slots"], exact: false });
  }

  // Also invalidate auth user to refresh activeStudentId in UI
  queryClient.invalidateQueries({ queryKey: ["auth", "user"] });
}

// ---- Admin queries ----

export const adminStudentsQuery = queryOptions({
  queryKey: ["admin", "students"],
  queryFn: () => Effect.runPromise(api.studentsStaff.students()),
});

export const adminCoursesQuery = queryOptions({
  queryKey: ["admin", "courses"],
  queryFn: () => Effect.runPromise(api.coursesAdmin.courses()),
});

export const adminFamiliesQuery = queryOptions({
  queryKey: ["admin", "families"],
  queryFn: () => Effect.runPromise(api.familiesAdmin.families()),
});

export const adminLessonsQuery = queryOptions({
  queryKey: ["admin-lessons"],
  queryFn: () => Effect.runPromise(api.lessonsAdmin.lessons({ query: {} })),
});

export const adminTodayLessonsQuery = (instant?: Date) => {
  const range = todayRange(instant);
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  return queryOptions({
    queryKey: ["admin", "lessons", "today", from, to],
    queryFn: () =>
      Effect.runPromise(
        api.lessonsAdmin.lessons({
          query: { from, to },
        }),
      ),
  });
};

export const adminWeekLessonsQuery = (instant?: Date) => {
  const range = weekRange(instant);
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  return queryOptions({
    queryKey: ["admin", "lessons", "week", from, to],
    queryFn: () => Effect.runPromise(api.lessonsAdmin.lessons({ query: { from, to } })),
  });
};

export const adminSubmissionsQuery = queryOptions({
  queryKey: ["admin", "submissions"],
  queryFn: () => Effect.runPromise(api.practiceAdmin.submissions({ query: {} })),
});

export const courseStudentsQuery = (id: string) =>
  queryOptions({
    queryKey: ["admin", "courses", id, "students"],
    queryFn: () => Effect.runPromise(api.coursesAdmin.courseStudents({ params: { id } })),
  });

export const studentDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["admin", "students", id],
    queryFn: () => Effect.runPromise(api.studentsStaff.student({ params: { id } })),
  });

// ---- Shared / student queries ----

export const libraryQuery = queryOptions({
  queryKey: ["library"],
  queryFn: () => Effect.runPromise(api.materials.library({ query: {} })),
});

export function messagesQuery(studentId?: string) {
  return queryOptions({
    queryKey: ["messages", studentId],
    queryFn: () => Effect.runPromise(api.messages.messages({ query: {} })),
  });
}

export function assignmentsQuery(studentId?: string) {
  return queryOptions({
    queryKey: ["assignments", studentId],
    queryFn: () => Effect.runPromise(api.materials.assignments()),
  });
}

export function practiceLogsQuery(studentId?: string) {
  return queryOptions({
    queryKey: ["practice-logs", studentId],
    queryFn: () => Effect.runPromise(api.practice.practiceLogs({ query: {} })),
  });
}

export function coursesQuery(studentId?: string) {
  return queryOptions({
    queryKey: ["courses", studentId],
    queryFn: () => Effect.runPromise(api.courses.courses()),
  });
}

export const courseDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["courses", id],
    queryFn: () => Effect.runPromise(api.courses.courseById({ params: { id } })),
  });

export function scheduledLessonsQuery(studentId?: string) {
  return queryOptions({
    queryKey: ["my-lessons", "scheduled", studentId],
    queryFn: () =>
      Effect.runPromise(api.lessons.myLessons({ query: { status: "scheduled", limit: 5 } })),
  });
}

export function myLessonsQuery(studentId?: string) {
  return queryOptions({
    queryKey: ["my-lessons", studentId],
    queryFn: () => Effect.runPromise(api.lessons.myLessons({ query: {} })),
  });
}

export function myLessonNotesQuery(studentId?: string) {
  return queryOptions({
    queryKey: ["my-lesson-notes", studentId],
    queryFn: () => Effect.runPromise(api.lessons.myLessonNotesList({ query: { limit: 100 } })),
  });
}

export const myEmailsQuery = queryOptions({
  queryKey: ["my-emails"],
  queryFn: () => Effect.runPromise(api.accounts.myEmails()),
});

export const gcalStatusQuery = queryOptions({
  queryKey: ["gcal-status"],
  queryFn: () => Effect.runPromise(api.calendarAdmin.gcalStatus()),
});

export const workingHoursQuery = queryOptions({
  queryKey: ["working-hours"],
  queryFn: () => Effect.runPromise(api.lessonsAdmin.workingHours()),
});

export const availableSlotsQuery = (date: string, studentId?: string) =>
  queryOptions({
    queryKey: ["available-slots", date, studentId],
    queryFn: () =>
      Effect.runPromise(
        api.lessons.availableSlots({ query: { date, days: 7, duration: 60 } }),
      ),
  });

export function useSwitchActiveStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) =>
      Effect.runPromise(
        api.accounts.switchActiveStudent({
          payload: { student_id: studentId },
        }),
      ),
    onSuccess: (_data, studentId) => {
      invalidateStudentQueries(queryClient, studentId);
    },
  });
}
