import { createFileRoute } from "@tanstack/react-router";

async function handleApiRequest({ request }: { request: Request }) {
  const { handleApiRequest } = await import("../../server/app.js");
  return handleApiRequest(request);
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handleApiRequest,
      POST: handleApiRequest,
      PUT: handleApiRequest,
      PATCH: handleApiRequest,
      DELETE: handleApiRequest,
      OPTIONS: handleApiRequest,
      HEAD: handleApiRequest,
    },
  },
});
