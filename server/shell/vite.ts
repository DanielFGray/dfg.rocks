import { Config, Effect, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Path from "effect/Path";
import * as ScopedRef from "effect/ScopedRef";
import * as Semaphore from "effect/Semaphore";
import type { Connect } from "vite";
import { startPage, type ServerEntry } from "./site.js";

type AppModule = typeof import("../app.js");

/**
 * The Site in development. Vite runs in middleware mode inside this process: it serves client
 * modules and HMR, and its SSR module runner loads the application and TanStack Start's server
 * entry, so the process loads each application module once.
 *
 * After an edit to any module it loaded, the runner reloads all of them, so the next import of
 * server/app.ts gives a new module. The next request then builds the application again from that
 * module and releases the old one, job runner and pools included, so services and routes always
 * come from one generation of modules.
 *
 * The process does not watch its own files: a restart by a file watcher would end the process
 * without releasing the job runner. After an edit to server/dev.ts or server/shell/, stop the
 * process with Ctrl-C and start it again.
 */
export const viteSite = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* path.fromFileUrl(new URL("../..", import.meta.url));
  const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000));
  // Loaded here so production never loads Vite.
  const { createServer, isRunnableDevEnvironment } = yield* Effect.promise(() => import("vite"));
  const node = {
    http: yield* Effect.promise(() => import("node:http")),
    net: yield* Effect.promise(() => import("node:net")),
  };
  const vite = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        createServer({
          root,
          server: { middlewareMode: true, hmr: { port: port + 1 } },
          appType: "custom",
        }),
      catch: (cause) => new ViteError({ message: `Vite did not start: ${String(cause)}` }),
    }),
    (server) => Effect.promise(() => server.close()),
  );
  const ssr = vite.environments.ssr;
  if (!isRunnableDevEnvironment(ssr)) {
    return yield* new ViteError({ message: "The SSR environment has no module runner" });
  }
  const importApp = Effect.promise(() => ssr.runner.import<AppModule>("/server/app.ts"));
  const importEntry = Effect.promise(() =>
    ssr.runner.import<{ readonly default: ServerEntry }>("virtual:tanstack-start-server-entry"),
  );
  const build = (module: AppModule) => Effect.map(module.App.make, (app) => ({ module, app }));

  const current = yield* ScopedRef.fromAcquire(Effect.flatMap(importApp, build));
  const rebuild = yield* Semaphore.make(1);
  const app = Effect.flatMap(importApp, (module) =>
    rebuild.withPermit(
      Effect.gen(function* () {
        const live = yield* ScopedRef.get(current);
        if (live.module === module) return live.app;
        yield* Effect.logInfo("Server code changed; building the application again");
        // A failed build keeps the old application, and the request answers 500.
        yield* ScopedRef.set(current, build(module)).pipe(
          Effect.tapCause((cause) => Effect.logError("The application did not build", cause)),
          Effect.orDie,
        );
        return (yield* ScopedRef.get(current)).app;
      }),
    ),
  );

  return {
    api: Effect.flatMap(app, ({ api }) => api),
    pages: Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      // Vite serves files only. Other methods go straight to TanStack Start with their body.
      if (request.method === "GET" || request.method === "HEAD") {
        const served = yield* runViteMiddleware(node, vite.middlewares, request);
        if (served !== undefined) return served;
      }
      const { services } = yield* app;
      const entry = yield* importEntry;
      return yield* startPage(entry.default.fetch, services);
    }),
  };
});

class ViteError extends Schema.TaggedError<ViteError, { readonly brand: unique symbol }>()(
  "ViteError",
  {
    message: Schema.String,
  },
) {}

/**
 * Runs Vite's Connect middleware for one request. Vite takes node:http request and response
 * objects, so a bare IncomingMessage carries the method, URL and headers, and a ServerResponse
 * collects what Vite writes. Gives `undefined` when Vite passes the request on, which means the
 * path is a page.
 */
const runViteMiddleware = (
  node: { readonly http: typeof import("node:http"); readonly net: typeof import("node:net") },
  middlewares: Connect.Server,
  request: HttpServerRequest.HttpServerRequest,
) =>
  Effect.callback<HttpServerResponse.HttpServerResponse | undefined>((resume) => {
    const req = new node.http.IncomingMessage(new node.net.Socket());
    req.method = request.method;
    req.url = request.url;
    Object.assign(req, { originalUrl: request.url });
    req.headers = { ...request.headers };

    const res = new node.http.ServerResponse(req);
    const chunks: Array<Uint8Array> = [];
    let settled = false;
    const settle = (response: HttpServerResponse.HttpServerResponse | undefined) => {
      if (settled) return;
      settled = true;
      resume(Effect.succeed(response));
    };
    const append = (chunk: string | Uint8Array | undefined) => {
      if (chunk !== undefined)
        chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk));
    };

    res.write = function (chunk: string | Uint8Array) {
      append(chunk);
      return true;
    } as typeof res.write;
    res.end = function (this: typeof res, chunk?: string | Uint8Array) {
      append(chunk);
      settle(collectedResponse(res.statusCode, res.getHeaders(), chunks));
      return this;
    } as typeof res.end;

    middlewares(req as never, res as never, () => settle(undefined));
  });

const collectedResponse = (
  status: number,
  written: Record<string, number | string | ReadonlyArray<string> | undefined>,
  chunks: ReadonlyArray<Uint8Array>,
) => {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(written)) {
    if (value !== undefined)
      headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  const { "content-type": contentType, ...rest } = headers;
  return chunks.length === 0
    ? HttpServerResponse.empty({ status, headers: rest })
    : HttpServerResponse.uint8Array(Buffer.concat(chunks), {
        status,
        headers: rest,
        contentType,
      });
};
