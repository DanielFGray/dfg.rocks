export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export const statusBadgeClass: Record<string, string> = {
  scheduled: "bg-blue-500/20 text-blue-400",
  completed: "bg-green-500/20 text-green-400",
  cancelled: "bg-red-500/20 text-red-400",
  no_show: "bg-amber-500/20 text-amber-400",
};

export const statusLabels: Record<string, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

export const locationLabels: Record<string, string> = {
  in_person_teacher_travels: "Teacher Travels",
  in_person_student_travels: "Student Travels",
  studio: "Studio",
  online: "Online",
};

export const locationLabel: Record<string, string> = {
  in_person_teacher_travels: "In-Person",
  in_person_student_travels: "In-Person",
  studio: "Studio",
  online: "Online",
};
