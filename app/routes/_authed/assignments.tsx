import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/assignments")({
  component: AssignmentsLayout,
});

function AssignmentsLayout() {
  return <Outlet />;
}
