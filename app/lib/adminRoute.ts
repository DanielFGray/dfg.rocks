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
