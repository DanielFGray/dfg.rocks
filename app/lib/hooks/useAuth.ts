import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
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

/**
 * Whether someone is signed in, read without blocking the page on the answer.
 *
 * The answer is unknown until the auth query has run, so this returns null then and a boolean
 * after. A caller that must not block the page uses this; a caller that can wait uses useAuth.
 */
export function useIsSignedIn(): boolean | null {
  const { data } = useQuery(authUserQuery);

  return data ? data.user !== null : null;
}
