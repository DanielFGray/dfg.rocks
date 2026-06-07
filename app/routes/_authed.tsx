import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { PortalNav } from "../components/PortalNav.js";
import { useRealtimeSync } from "../lib/hooks/useRealtimeSync.js";
import { useAuth } from "../lib/hooks/useAuth.js";
import { normalizeLoginRedirect } from "../lib/loginRedirect.js";
import { fetchAuthUser } from "../lib/queries.js";

export const Route = createFileRoute("/_authed")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const result = await fetchAuthUser(context.queryClient);

    if (!result.user) {
      throw redirect({
        to: "/login",
        search: { redirect: normalizeLoginRedirect(location.href) },
      });
    }

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
