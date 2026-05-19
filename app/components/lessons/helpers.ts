import * as v from "valibot";
import type { LocationType } from "../../lib/types.js";

export const requiredValidator = {
  onChange: v.pipe(v.string(), v.minLength(1, "Required")),
};

export const durationOptions = [
  { value: "30", label: "30 minutes" },
  { value: "60", label: "60 minutes" },
];

export const locationOptions: Array<{
  value: "" | LocationType;
  label: string;
}> = [
  { value: "", label: "Select location..." },
  { value: "in_person_teacher_travels", label: "In-Person (Teacher Travels)" },
  { value: "in_person_student_travels", label: "In-Person (Student Travels)" },
  { value: "studio", label: "Studio" },
  { value: "online", label: "Online" },
];

export const statusBadgeClass: Record<string, string> = {
  scheduled: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  cancelled: "bg-red-500/20 text-red-400",
  no_show: "bg-amber-500/20 text-amber-400",
};

export const statusLabel: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

export const locationLabel: Record<string, string> = {
  in_person_teacher_travels: "In-Person (Teacher Travels)",
  in_person_student_travels: "In-Person (Student Travels)",
  studio: "Studio",
  online: "Online",
};

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
