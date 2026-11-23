import { useSuspenseQuery } from "@tanstack/react-query";
import { authUserQuery } from "../queries.js";
import type { AuthState } from "../auth.js";

export function useAuth(): AuthState & { isAdmin: boolean; isStaff: boolean } {
  const { data } = useSuspenseQuery(authUserQuery);

  return {
    user: data.user,
    isAdmin: data.user?.role === "admin",
    // Staff are admins and teachers; the Staff API guard admits the same two roles.
    isStaff: data.user?.role === "admin" || data.user?.role === "teacher",
    needsOnboarding: data.needsOnboarding,
    isParent: data.isParent,
    familyStudents: data.familyStudents,
    activeStudentId: data.activeStudentId,
    activeStudent: data.activeStudent,
  };
}
