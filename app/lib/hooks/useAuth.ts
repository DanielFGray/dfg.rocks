import { useSuspenseQuery } from "@tanstack/react-query";
import { authUserQuery } from "../queries.js";

export function useAuth() {
  const { data } = useSuspenseQuery(authUserQuery);

  return {
    user: data.user,
    isAdmin: data.user?.role === "admin",
  };
}
