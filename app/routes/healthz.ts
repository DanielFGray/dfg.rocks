import { createFileRoute } from "@tanstack/react-router";

// The platform health check requests /healthz at the root, outside the /api catch-all.
async function handleHealthz({ request }: { request: Request }) {
  const { handleApiRequest } = await import("../../server/app.js");
  return handleApiRequest(request);
}

export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: handleHealthz,
    },
  },
});
