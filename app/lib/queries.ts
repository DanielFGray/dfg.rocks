import { queryOptions } from "@tanstack/react-query";
import { api } from "./api.js";

/**
 * Strip Eden treaty's `{ error: string } | null` phantom variants from `data`.
 * Safe because the client is configured with `throwHttpError: true`.
 */
type EdenData<T> = Exclude<NonNullable<T>, { error: string }>;
export function unwrap<T>(data: T): EdenData<T> {
  return data as EdenData<T>;
}

// ---- Admin queries ----

export const adminStudentsQuery = queryOptions({
  queryKey: ["admin", "students"],
  queryFn: async () => unwrap((await api.admin.students.get()).data),
});

export const adminCoursesQuery = queryOptions({
  queryKey: ["admin", "courses"],
  queryFn: async () => unwrap((await api.admin.courses.get()).data),
});

export const adminFamiliesQuery = queryOptions({
  queryKey: ["admin", "families"],
  queryFn: async () => unwrap((await api.admin.families.get()).data),
});

export const adminLessonsQuery = queryOptions({
  queryKey: ["admin-lessons"],
  queryFn: async () => unwrap((await api.admin.lessons.get()).data),
});

export const adminTodayLessonsQuery = () => {
  const todayStr = new Date().toISOString().slice(0, 10);
  return queryOptions({
    queryKey: ["admin", "lessons", "today", todayStr],
    queryFn: async () =>
      unwrap(
        (
          await api.admin.lessons.get({
            query: { from: `${todayStr}T00:00:00.000Z`, to: `${todayStr}T23:59:59.999Z` },
          })
        ).data,
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
    queryFn: async () =>
      unwrap((await api.admin.lessons.get({ query: { from: weekStart, to: weekEnd } })).data),
  });
};

export const adminSubmissionsQuery = queryOptions({
  queryKey: ["admin", "submissions"],
  queryFn: async () => unwrap((await api.admin.submissions.get()).data),
});

export const courseStudentsQuery = (id: string) =>
  queryOptions({
    queryKey: ["admin", "courses", id, "students"],
    queryFn: async () => unwrap((await api.admin.courses({ id }).students.get()).data),
  });

export const studentDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["admin", "students", id],
    queryFn: async () => unwrap((await api.admin.students({ id }).get()).data),
  });

// ---- Shared / student queries ----

export const libraryQuery = queryOptions({
  queryKey: ["library"],
  queryFn: async () => unwrap((await api.library.get()).data),
});

export const messagesQuery = queryOptions({
  queryKey: ["messages"],
  queryFn: async () => unwrap((await api.messages.get()).data),
});

export const assignmentsQuery = queryOptions({
  queryKey: ["assignments"],
  queryFn: async () => unwrap((await api.assignments.get()).data),
});

export const practiceLogsQuery = queryOptions({
  queryKey: ["practice-logs"],
  queryFn: async () => unwrap((await api["practice-logs"].get()).data),
});

export const coursesQuery = queryOptions({
  queryKey: ["courses"],
  queryFn: async () => unwrap((await api.courses.get()).data),
});

export const courseDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["courses", id],
    queryFn: async () => unwrap((await api.courses({ id }).get()).data),
  });

export const scheduledLessonsQuery = queryOptions({
  queryKey: ["my-lessons", "scheduled"],
  queryFn: async () =>
    unwrap((await api["my-lessons"].get({ query: { status: "scheduled", limit: 5 } })).data),
});

export const myLessonsQuery = queryOptions({
  queryKey: ["my-lessons"],
  queryFn: async () => unwrap((await api["my-lessons"].get()).data),
});

export const myLessonNotesQuery = queryOptions({
  queryKey: ["my-lesson-notes"],
  queryFn: async () => unwrap((await api["my-lesson-notes"].get({ query: { limit: 100 } })).data),
});

export const myEmailsQuery = queryOptions({
  queryKey: ["my-emails"],
  queryFn: async () => unwrap((await api.me.emails.get()).data),
});

export const gcalStatusQuery = queryOptions({
  queryKey: ["gcal-status"],
  queryFn: async () => unwrap((await api.admin.gcal.status.get()).data),
});

export const workingHoursQuery = queryOptions({
  queryKey: ["working-hours"],
  queryFn: async () => unwrap((await api.admin["working-hours"].get()).data),
});

export const availableSlotsQuery = (date: string) =>
  queryOptions({
    queryKey: ["available-slots", date],
    queryFn: async () =>
      unwrap((await api["available-slots"].get({ query: { date, days: 7, duration: 60 } })).data),
  });
