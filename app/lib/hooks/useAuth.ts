import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { api } from "../api.js";

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async () => {
    const { data, error } = await api.me.get();
    if (error) throw error;
    return data;
  },
  staleTime: 5 * 60 * 1000,
});

export function useAuth() {
  const { data } = useSuspenseQuery(meQuery);

  return {
    user: data.user,
    isAdmin: data.user?.role === "admin",
  };
}
