import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { PortalNav } from "../components/PortalNav.js";
import { getAuthUser } from "../lib/auth.js";
import { useRealtimeSync } from "../lib/hooks/useRealtimeSync.js";
import { useAuth } from "../lib/hooks/useAuth.js";
import { normalizeLoginRedirect } from "../lib/loginRedirect.js";

export const Route = createFileRoute("/_authed")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const result = await getAuthUser();

    if (!result.user) {
      throw redirect({
        to: "/login",
        search: { redirect: normalizeLoginRedirect(location.href) },
      });
    }

    return { user: result.user, isAdmin: result.user.role === "admin" };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = useAuth();
  useRealtimeSync(Boolean(user));

  return (
    <>
      <PortalNav />
      <Outlet />
    </>
  );
}
