import { Effect } from "effect";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api } from "./api.js";
import { getAuthUser } from "./auth.js";

export const authUserQuery = queryOptions({
  queryKey: ["auth", "user"],
  queryFn: () => getAuthUser(),
});

export function fetchAuthUser(queryClient: QueryClient) {
  return queryClient.fetchQuery({
    ...authUserQuery,
    staleTime: 0,
  });
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
  queryFn: () => Effect.runPromise(api.admin.lessons({ urlParams: {} })),
});

export const adminTodayLessonsQuery = () => {
  const todayStr = new Date().toISOString().slice(0, 10);
  return queryOptions({
    queryKey: ["admin", "lessons", "today", todayStr],
    queryFn: () =>
      Effect.runPromise(
        api.admin.lessons({
          urlParams: {
            from: `${todayStr}T00:00:00.000Z`,
            to: `${todayStr}T23:59:59.999Z`,
          },
        }),
      ),
  });
};

export const adminWeekLessonsQuery = () => {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = monday.toISOString().slice(0, 10) + "T00:00:00.000Z";
  const weekEnd = sunday.toISOString().slice(0, 10) + "T23:59:59.999Z";
  return queryOptions({
    queryKey: ["admin", "lessons", "week", weekStart],
    queryFn: () =>
      Effect.runPromise(
        api.admin.lessons({ urlParams: { from: weekStart, to: weekEnd } }),
      ),
  });
};

export const adminSubmissionsQuery = queryOptions({
  queryKey: ["admin", "submissions"],
  queryFn: () => Effect.runPromise(api.admin.submissions({ urlParams: {} })),
});

export const courseStudentsQuery = (id: string) =>
  queryOptions({
    queryKey: ["admin", "courses", id, "students"],
    queryFn: () => Effect.runPromise(api.admin.courseStudents({ path: { id } })),
  });

export const studentDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["admin", "students", id],
    queryFn: () => Effect.runPromise(api.admin.student({ path: { id } })),
  });

// ---- Shared / student queries ----

export const libraryQuery = queryOptions({
  queryKey: ["library"],
  queryFn: () => Effect.runPromise(api.authenticated.library({ urlParams: {} })),
});

export const messagesQuery = queryOptions({
  queryKey: ["messages"],
  queryFn: () => Effect.runPromise(api.authenticated.messages({ urlParams: {} })),
});

export const assignmentsQuery = queryOptions({
  queryKey: ["assignments"],
  queryFn: () => Effect.runPromise(api.authenticated.assignments()),
});

export const practiceLogsQuery = queryOptions({
  queryKey: ["practice-logs"],
  queryFn: () => Effect.runPromise(api.authenticated.practiceLogs({ urlParams: {} })),
});

export const coursesQuery = queryOptions({
  queryKey: ["courses"],
  queryFn: () => Effect.runPromise(api.authenticated.courses()),
});

export const courseDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["courses", id],
    queryFn: () => Effect.runPromise(api.authenticated.courseById({ path: { id } })),
  });

export const scheduledLessonsQuery = queryOptions({
  queryKey: ["my-lessons", "scheduled"],
  queryFn: () =>
    Effect.runPromise(
      api.authenticated.myLessons({ urlParams: { status: "scheduled", limit: 5 } }),
    ),
});

export const myLessonsQuery = queryOptions({
  queryKey: ["my-lessons"],
  queryFn: () => Effect.runPromise(api.authenticated.myLessons({ urlParams: {} })),
});

export const myLessonNotesQuery = queryOptions({
  queryKey: ["my-lesson-notes"],
  queryFn: () =>
    Effect.runPromise(
      api.authenticated.myLessonNotesList({ urlParams: { limit: 100 } }),
    ),
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
        api.authenticated.availableSlots({ urlParams: { date, days: 7, duration: 60 } }),
      ),
  });
