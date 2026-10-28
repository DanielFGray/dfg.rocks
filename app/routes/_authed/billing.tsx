import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { fetchAuthUser } from "../../lib/queries.js";
import { useAuth } from "../../lib/hooks/useAuth.js";

export const Route = createFileRoute("/_authed/billing")({
  beforeLoad: async ({ context }) => {
    const auth = await fetchAuthUser(context.queryClient);
    if (auth.user?.role !== "admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: BillingLayout,
});

function BillingLayout() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return null;
  return <Outlet />;
}
