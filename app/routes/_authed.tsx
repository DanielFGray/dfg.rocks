import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { PortalNav } from "../components/PortalNav.js";
import { meQuery } from "../lib/hooks/useAuth.js";

export const Route = createFileRoute("/_authed")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    const { user } = await context.queryClient.ensureQueryData(meQuery);

    if (!user) {
      throw redirect({ to: "/login" });
    }

    return { user, isAdmin: user.role === "admin" };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <>
      <PortalNav />
      <Outlet />
    </>
  );
}
