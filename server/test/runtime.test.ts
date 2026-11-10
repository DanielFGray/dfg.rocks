import { beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => {
  const services = { id: "canonical-server-services" };
  const handlers: Array<ReturnType<typeof vi.fn>> = [];

  const getContext = vi.fn(async () => services);
  const disposeRuntime = vi.fn(async () => undefined);
  const disposeWebHandler = vi.fn(async () => undefined);
  const toWebHandler = vi.fn((_layer: unknown, _options: unknown) => {
    const handlerNumber = handlers.length + 1;
    const handler = vi.fn(
      async (_request: Request, _services: unknown) =>
        new Response(null, {
          status: 204,
          headers: { "x-test-handler": String(handlerNumber) },
        }),
    );
    handlers.push(handler);
    return { handler, dispose: disposeWebHandler };
  });

  return { disposeRuntime, disposeWebHandler, getContext, handlers, services, toWebHandler };
});

// app.ts runs one effect on the runtime before it builds the handler: the NODE_ENV read. Production
// skips the dynamic import of the testing routes, which these mocks do not cover.
vi.mock("../runtime.js", () => ({
  serverRuntime: {
    context: lifecycle.getContext,
    dispose: lifecycle.disposeRuntime,
    runPromise: async () => "production",
  },
}));

vi.mock("effect/http-api/HttpApi", () => ({
  make: () => {
    const api = { add: vi.fn(() => api) };
    return api;
  },
}));
vi.mock("effect/http-api/HttpApiBuilder", () => {
  const layer = { pipe: () => layer };
  return { layer: () => layer };
});
vi.mock("effect/http/HttpRouter", () => ({
  provideRequest: () => (layer: unknown) => layer,
  toWebHandler: lifecycle.toWebHandler,
}));
vi.mock("effect/Layer", () => ({
  mergeAll: () => ({}),
  provide: () => (layer: unknown) => layer,
  succeedContext: () => ({}),
}));

vi.mock("../../shared/httpApi.js", () => ({
  authGroup: {},
  healthGroup: {},
  publicGroup: {},
  familyBillingGroup: {},
  adminGroup: {},
  authenticatedClientGroup: {},
}));
vi.mock("../routes/admin.js", () => ({
  adminGroup: {},
  makeAdminLayer: () => ({}),
  makeMaterialDownloadLayer: () => ({}),
  materialDownloadGroup: {},
}));
vi.mock("../routes/auth.js", () => ({ makeAuthLayer: () => ({}) }));
vi.mock("../routes/authenticated.js", () => ({
  authenticatedGroup: {},
  makeAuthenticatedLayer: () => ({}),
}));
vi.mock("../routes/public.js", () => ({
  makeHealthLayer: () => ({}),
  makePublicLayer: () => ({}),
}));

describe("API runtime lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifecycle.handlers.length = 0;
    vi.resetModules();
  });

  it("initializes one runtime-backed handler for concurrent requests", async () => {
    const { handleApiRequest } = await import("../app.js");

    const [firstResponse, secondResponse] = await Promise.all([
      handleApiRequest(new Request("http://localhost/api/first")),
      handleApiRequest(new Request("http://localhost/api/second")),
    ]);

    expect(firstResponse.headers.get("x-test-handler")).toBe("1");
    expect(secondResponse.headers.get("x-test-handler")).toBe("1");
    expect(lifecycle.getContext).toHaveBeenCalledOnce();
    expect(lifecycle.toWebHandler).toHaveBeenCalledOnce();
    expect(lifecycle.handlers).toHaveLength(1);
    expect(lifecycle.handlers[0]).toHaveBeenCalledTimes(2);
    expect(lifecycle.handlers[0]).toHaveBeenCalledWith(expect.any(Request), lifecycle.services);
  });

  it("disposes the handler and the canonical runtime after the handler has initialized", async () => {
    const { disposeApiHandler, handleApiRequest } = await import("../app.js");

    const response = await handleApiRequest(new Request("http://localhost/api/request"));
    await disposeApiHandler();

    expect(response.headers.get("x-test-handler")).toBe("1");
    expect(lifecycle.disposeWebHandler).toHaveBeenCalledOnce();
    expect(lifecycle.disposeRuntime).toHaveBeenCalledOnce();
    expect(lifecycle.getContext).toHaveBeenCalledOnce();
    expect(lifecycle.handlers).toHaveLength(1);
    expect(lifecycle.handlers[0]).toHaveBeenCalledOnce();
  });

  it("can dispose before initialization without constructing a handler", async () => {
    const { disposeApiHandler } = await import("../app.js");

    await disposeApiHandler();

    expect(lifecycle.disposeRuntime).toHaveBeenCalledOnce();
    expect(lifecycle.disposeWebHandler).not.toHaveBeenCalled();
    expect(lifecycle.getContext).not.toHaveBeenCalled();
    expect(lifecycle.toWebHandler).not.toHaveBeenCalled();
    expect(lifecycle.handlers).toHaveLength(0);
  });
});
