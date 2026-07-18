import { useSuspenseQuery } from "@tanstack/react-query";
import { authUserQuery } from "../queries.js";
import type { AuthState } from "../auth.js";

export function useAuth(): AuthState & { isAdmin: boolean } {
  const { data } = useSuspenseQuery(authUserQuery);

  return {
    user: data.user,
    isAdmin: data.user?.role === "admin",
    isParent: data.isParent,
    familyStudents: data.familyStudents,
    activeStudentId: data.activeStudentId,
    activeStudent: data.activeStudent,
  };
}
