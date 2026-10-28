import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useAuth } from "../../../lib/hooks/useAuth.js";

export const Route = createFileRoute("/_authed/family/billing")({
  head: () => ({ meta: [{ title: "Billing | DFG Portal" }] }),
  component: FamilyBillingLayout,
});

function FamilyBillingLayout() {
  const { user, isAdmin } = useAuth();
  if (isAdmin || !user) return null;
  return <Outlet />;
}
