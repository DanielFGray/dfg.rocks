import type { QueryClient } from "@tanstack/react-query";
import type { RegisteredRouter } from "@tanstack/react-router";

export async function resetAuthClientState({
  queryClient,
  router,
}: {
  queryClient: QueryClient;
  router: RegisteredRouter;
}) {
  queryClient.clear();
  await router.invalidate();
}
