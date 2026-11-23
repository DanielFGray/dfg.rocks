import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { PortalNav } from "../components/PortalNav.js";
import { useRealtimeSync } from "../lib/hooks/useRealtimeSync.js";
import { useAuth } from "../lib/hooks/useAuth.js";
import { normalizeLoginRedirect } from "../lib/loginRedirect.js";
import { fetchAuthUser } from "../lib/queries.js";

export const Route = createFileRoute("/_authed")({
  ssr: "data-only",
  beforeLoad: async ({ context, location }) => {
    const result = await fetchAuthUser(context.queryClient);

    if (!result.user) {
      throw redirect({
        to: "/login",
        search: { redirect: normalizeLoginRedirect(location.href) },
      });
    }
    // A student or parent who has not finished onboarding sees nothing else first.
    if (result.needsOnboarding && location.pathname !== "/onboarding") {
      throw redirect({ to: "/onboarding" });
    }
    if (!result.needsOnboarding && location.pathname === "/onboarding") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  useRealtimeSync(Boolean(user));

  return (
    <>
      {pathname === "/onboarding" ? null : <PortalNav />}
      <Outlet />
    </>
  );
}
