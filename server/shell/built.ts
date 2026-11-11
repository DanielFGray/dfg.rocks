import { Effect, Layer } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpStaticServer from "effect/http/HttpStaticServer";
import * as Path from "effect/Path";
import { Site, startPage, type ServerEntry } from "./site.js";

/**
 * The Site from the production build: the TanStack Start bundle in dist/server, and the client
 * files in dist/client. The bundle carries the application code, so the process loads each module
 * once.
 */
export const BuiltSite = Layer.effect(
  Site,
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const root = yield* path.fromFileUrl(new URL("../..", import.meta.url));
    const entry = yield* importBundle(path.join(root, "dist/server/server.js"));
    const app = yield* entry.makeApp(path.join(root, "worker"));
    const page = startPage(entry.fetch, app.services);

    const clientDirectory = path.join(root, "dist/client");
    // Hashed build assets never change content under one name.
    const assets = yield* HttpStaticServer.make({
      root: clientDirectory,
      index: undefined,
      cacheControl: "public, max-age=31536000, immutable",
    });
    const files = yield* HttpStaticServer.make({
      root: clientDirectory,
      index: undefined,
      cacheControl: "public, max-age=3600",
    });

    return {
      api: app.api,
      pages: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (request.method !== "GET" && request.method !== "HEAD") return yield* page;
        // A path with no file under dist/client, or outside it, is a page.
        return yield* (request.url.startsWith("/assets/") ? assets : files).pipe(
          Effect.catchReason("HttpServerError", "RouteNotFound", () => page),
        );
      }),
    };
  }),
);

// The bundle is built output with no type declarations, so its default export is typed from the
// source of the server entry it was built from.
const importBundle = (file: string) =>
  Effect.promise((): Promise<{ readonly default: ServerEntry }> => import(file)).pipe(
    Effect.map((module) => module.default),
  );
