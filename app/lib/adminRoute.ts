import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { fetchAuthUser } from "./queries.js";

/**
 * `beforeLoad` for an admin-only page: anyone else goes to the dashboard before the page's loader
 * asks the server for admin data, which it would refuse.
 */
export async function requireAdmin({ context }: { context: { queryClient: QueryClient } }) {
  const auth = await fetchAuthUser(context.queryClient);
  if (auth.user?.role !== "admin") throw redirect({ to: "/dashboard" });
}

/**
 * `beforeLoad` for a page that admins and teachers may open. Anyone else goes to the dashboard.
 * Changing a role on such a page is still admin-only; the page checks the role itself.
 */
export async function requireStaff({ context }: { context: { queryClient: QueryClient } }) {
  const auth = await fetchAuthUser(context.queryClient);
  const role = auth.user?.role;
  if (role !== "admin" && role !== "teacher") throw redirect({ to: "/dashboard" });
}
