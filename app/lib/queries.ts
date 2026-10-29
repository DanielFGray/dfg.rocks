import { Effect } from "effect";
import { queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./api.js";
import { decodeAuthState, getAuthUser } from "./auth.js";
import { todayRange, weekRange } from "../../shared/dateRanges.js";

export const authUserQuery = queryOptions({
  queryKey: ["auth", "user"],
  queryFn: getAuthUser,
  select: decodeAuthState,
  staleTime: 5_000,
});

export async function fetchAuthUser(queryClient: QueryClient) {
  const cached = queryClient.getQueryData<string>(authUserQuery.queryKey);
  if (cached) return decodeAuthState(cached);
  return decodeAuthState(await queryClient.fetchQuery(authUserQuery));
}

// ---- Admin queries ----

export const adminStudentsQuery = queryOptions({
  queryKey: ["admin", "students"],
  queryFn: () => Effect.runPromise(api.admin.students()),
});

export const adminCoursesQuery = queryOptions({
  queryKey: ["admin", "courses"],
  queryFn: () => Effect.runPromise(api.admin.courses()),
});

export const adminFamiliesQuery = queryOptions({
  queryKey: ["admin", "families"],
  queryFn: () => Effect.runPromise(api.admin.families()),
});

export const adminLessonsQuery = queryOptions({
  queryKey: ["admin-lessons"],
  queryFn: () => Effect.runPromise(api.admin.lessons({ query: {} })),
});

export const adminTodayLessonsQuery = (instant?: Date) => {
  const range = todayRange(instant);
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  return queryOptions({
    queryKey: ["admin", "lessons", "today", from, to],
    queryFn: () =>
      Effect.runPromise(
        api.admin.lessons({
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
    queryFn: () => Effect.runPromise(api.admin.lessons({ query: { from, to } })),
  });
};

export const adminSubmissionsQuery = queryOptions({
  queryKey: ["admin", "submissions"],
  queryFn: () => Effect.runPromise(api.admin.submissions({ query: {} })),
});

export const courseStudentsQuery = (id: string) =>
  queryOptions({
    queryKey: ["admin", "courses", id, "students"],
    queryFn: () => Effect.runPromise(api.admin.courseStudents({ params: { id } })),
  });

export const studentDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["admin", "students", id],
    queryFn: () => Effect.runPromise(api.admin.student({ params: { id } })),
  });

// ---- Shared / student queries ----

export const libraryQuery = queryOptions({
  queryKey: ["library"],
  queryFn: () => Effect.runPromise(api.authenticated.library({ query: {} })),
});

export const messagesQuery = queryOptions({
  queryKey: ["messages"],
  queryFn: () => Effect.runPromise(api.authenticated.messages({ query: {} })),
});

export const assignmentsQuery = queryOptions({
  queryKey: ["assignments"],
  queryFn: () => Effect.runPromise(api.authenticated.assignments()),
});

export const practiceLogsQuery = queryOptions({
  queryKey: ["practice-logs"],
  queryFn: () => Effect.runPromise(api.authenticated.practiceLogs({ query: {} })),
});

export const coursesQuery = queryOptions({
  queryKey: ["courses"],
  queryFn: () => Effect.runPromise(api.authenticated.courses()),
});

export const courseDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["courses", id],
    queryFn: () => Effect.runPromise(api.authenticated.courseById({ params: { id } })),
  });

export const scheduledLessonsQuery = queryOptions({
  queryKey: ["my-lessons", "scheduled"],
  queryFn: () =>
    Effect.runPromise(api.authenticated.myLessons({ query: { status: "scheduled", limit: 5 } })),
});

export const myLessonsQuery = queryOptions({
  queryKey: ["my-lessons"],
  queryFn: () => Effect.runPromise(api.authenticated.myLessons({ query: {} })),
});

export const myLessonNotesQuery = queryOptions({
  queryKey: ["my-lesson-notes"],
  queryFn: () => Effect.runPromise(api.authenticated.myLessonNotesList({ query: { limit: 100 } })),
});

export const myEmailsQuery = queryOptions({
  queryKey: ["my-emails"],
  queryFn: () => Effect.runPromise(api.authenticated.myEmails()),
});

export const gcalStatusQuery = queryOptions({
  queryKey: ["gcal-status"],
  queryFn: () => Effect.runPromise(api.admin.gcalStatus()),
});

export const workingHoursQuery = queryOptions({
  queryKey: ["working-hours"],
  queryFn: () => Effect.runPromise(api.admin.workingHours()),
});

export const availableSlotsQuery = (date: string) =>
  queryOptions({
    queryKey: ["available-slots", date],
    queryFn: () =>
      Effect.runPromise(
        api.authenticated.availableSlots({ query: { date, days: 7, duration: 60 } }),
      ),
  });

export function useSwitchActiveStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) =>
      Effect.runPromise(
        api.authenticated.switchActiveStudent({
          payload: { student_id: studentId },
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "user"] });
    },
  });
}
