import type { ContentVisibility } from "../../shared/schemas.js";

/** The levels an admin picks for a course or a material, with what each lets a reader do. */
export const visibilityOptions: { value: ContentVisibility; label: string }[] = [
  { value: "course", label: "Course only: enrolled, scheduled or subscribed readers" },
  { value: "global", label: "Admitted accounts: anyone with a role" },
  { value: "public", label: "Free: any signed-in account" },
];
