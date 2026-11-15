import { Outlet, createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "../../lib/adminRoute.js";
import { useAuth } from "../../lib/hooks/useAuth.js";

export const Route = createFileRoute("/_authed/billing")({
  beforeLoad: requireAdmin,
  component: BillingLayout,
});

function BillingLayout() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return null;
  return <Outlet />;
}
