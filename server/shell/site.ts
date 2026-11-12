import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import { Config, Context, Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerError from "effect/http/HttpServerError";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Scope } from "effect/Scope";
import { builtSite } from "./built.js";
import { viteSite } from "./vite.js";
import type { App } from "../app.js";

/** The TanStack Start server entry (app/server.ts) as the shell sees it. */
export type ServerEntry = (typeof import("../../app/server.js"))["default"];

type Handler = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  HttpServerError.HttpServerError,
  HttpServerRequest.HttpServerRequest | Scope
>;

/**
 * The application as the process shell serves it. `api` answers /api and /healthz; `pages` answers
 * every other path: client files, then TanStack Start. The production shell (server/main.ts) takes
 * both from the build; the development shell (server/dev.ts) from Vite.
 */
export class Site extends Context.Service<
  Site,
  { readonly api: Handler; readonly pages: Handler }
>()("dfg-rocks/site", {
  make: Effect.gen(function* () {
    const mode = yield* Config.String("NODE_ENV");
    return yield* mode === "production" ? builtSite : viteSite;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
  static readonly layerBuilt = Layer.effect(this, builtSite);
  static readonly layerVite = Layer.effect(this, viteSite);
}

/**
 * Serves a Site over HTTP. The site is built before the HTTP server and released after it, so on
 * SIGTERM or SIGINT the server stops taking requests first, then the job runner stops, then the
 * database pools close.
 */
// This function accepts the site layer so the server is released before the site.
// ast-grep-ignore: no-exported-layer-function
export const serveSite = <E>(site: Layer.Layer<Site, E>, options: { readonly host: string }) =>
  HttpRouter.serve(routes, { disableLogger: true }).pipe(
    Layer.provide(
      BunHttpServer.layerConfig({
        port: Config.Port("PORT").pipe(Config.withDefault(3000)),
        hostname: Config.String("HOST").pipe(Config.withDefault(options.host)),
      }),
    ),
    Layer.provide(site),
  );

/**
 * Hands a request to TanStack Start, with the application's services in its request context. Server
 * functions run their Effects on those services (app/lib/serverEffect.ts).
 */
export const startPage = (fetch: ServerEntry["fetch"], services: App["Service"]["services"]) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.toWeb(yield* HttpServerRequest.HttpServerRequest).pipe(
      Effect.mapError((reason) => new HttpServerError.HttpServerError({ reason })),
    );
    const response = yield* Effect.promise(async () => fetch(request, { context: { services } }));
    return HttpServerResponse.fromWeb(response);
  });

const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const site = yield* Site;
    // An unknown /api path answers the API's 404, never a page. "/api/*" also matches "/api".
    yield* router.add("*", "/api/*", site.api);
    yield* router.add("*", "/healthz", site.api);
    yield* router.add("*", "*", site.pages);
  }),
);
