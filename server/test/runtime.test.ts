import { beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => {
  const runtime = { id: "canonical-server-runtime" };
  const handlers: Array<ReturnType<typeof vi.fn>> = [];

  const runPromise = vi.fn(async () => ({ id: "http-app" }));
  const getRuntime = vi.fn(async () => runtime);
  const dispose = vi.fn(async () => undefined);
  const toWebHandlerRuntime = vi.fn((_providedRuntime: unknown) => (_httpApp: unknown) => {
    const handlerNumber = handlers.length + 1;
    const handler = vi.fn(async () =>
      new Response(null, {
        status: 204,
        headers: { "x-test-handler": String(handlerNumber) },
      }),
    );
    handlers.push(handler);
    return handler;
  });

  return {
    dispose,
    getRuntime,
    handlers,
    runPromise,
    runtime,
    toWebHandlerRuntime,
  };
});

vi.mock("../assertEnv.js", () => ({ env: { NODE_ENV: "production" } }));
vi.mock("../runtime.js", () => ({
  serverRuntime: {
    dispose: lifecycle.dispose,
    runPromise: lifecycle.runPromise,
    runtime: lifecycle.getRuntime,
  },
}));

vi.mock("@effect/platform/HttpApi", () => ({
  make: () => {
    const api = { add: vi.fn(() => api) };
    return api;
  },
}));
vi.mock("@effect/platform/HttpApiBuilder", () => ({
  Middleware: { layer: {} },
  Router: { Live: {} },
  api: () => ({ pipe: () => ({}) }),
  httpApp: { pipe: () => ({}) },
}));
vi.mock("@effect/platform/HttpApp", () => ({
  toWebHandlerRuntime: lifecycle.toWebHandlerRuntime,
}));
vi.mock("effect/Effect", () => ({ provide: () => (effect: unknown) => effect }));
vi.mock("effect/Layer", () => ({
  mergeAll: () => ({}),
  provide: () => (layer: unknown) => layer,
}));

vi.mock("../../shared/httpApi.js", () => ({ authGroup: {}, publicGroup: {}, familyBillingGroup: {}, adminGroup: {}, authenticatedClientGroup: {} }));
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
vi.mock("../routes/public.js", () => ({ makePublicLayer: () => ({}) }));

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
    expect(lifecycle.runPromise).toHaveBeenCalledOnce();
    expect(lifecycle.getRuntime).toHaveBeenCalledOnce();
    expect(lifecycle.toWebHandlerRuntime).toHaveBeenCalledOnce();
    expect(lifecycle.toWebHandlerRuntime).toHaveBeenCalledWith(lifecycle.runtime);
    expect(lifecycle.handlers).toHaveLength(1);
    expect(lifecycle.handlers[0]).toHaveBeenCalledTimes(2);
  });

  it("disposes the canonical runtime after the handler has initialized", async () => {
    const { disposeApiHandler, handleApiRequest } = await import("../app.js");

    const response = await handleApiRequest(new Request("http://localhost/api/request"));
    await disposeApiHandler();

    expect(response.headers.get("x-test-handler")).toBe("1");
    expect(lifecycle.dispose).toHaveBeenCalledOnce();
    expect(lifecycle.runPromise).toHaveBeenCalledOnce();
    expect(lifecycle.getRuntime).toHaveBeenCalledOnce();
    expect(lifecycle.toWebHandlerRuntime).toHaveBeenCalledWith(lifecycle.runtime);
    expect(lifecycle.handlers).toHaveLength(1);
    expect(lifecycle.handlers[0]).toHaveBeenCalledOnce();
  });

  it("can dispose before initialization without constructing a handler", async () => {
    const { disposeApiHandler } = await import("../app.js");

    await disposeApiHandler();

    expect(lifecycle.dispose).toHaveBeenCalledOnce();
    expect(lifecycle.runPromise).not.toHaveBeenCalled();
    expect(lifecycle.getRuntime).not.toHaveBeenCalled();
    expect(lifecycle.toWebHandlerRuntime).not.toHaveBeenCalled();
    expect(lifecycle.handlers).toHaveLength(0);
  });
});
