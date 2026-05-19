import { getRouteApi } from "@tanstack/react-router";

const authedRouteApi = getRouteApi("/_authed");

export function useAuth() {
  const data = authedRouteApi.useRouteContext();

  return {
    user: data?.user ?? null,
    isAdmin: data?.user?.role === "admin",
  };
}
