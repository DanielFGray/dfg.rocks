import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { unwrap } from "../queries.js";

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async () => unwrap((await api.me.get()).data),
  staleTime: 5 * 60 * 1000,
});

export function useAuth() {
  const { data } = useSuspenseQuery(meQuery);

  return {
    user: data?.user ?? null,
    isAdmin: data?.user?.role === "admin",
  };
}
