import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import { authGroup, healthGroup, publicGroup } from "../shared/httpApi.js";
import { env } from "./assertEnv.js";
import {
  makeAdminLayer,
  adminGroup,
  makeMaterialDownloadLayer,
  materialDownloadGroup,
} from "./routes/admin.js";
import { makeAuthLayer } from "./routes/auth.js";
import { authenticatedGroup, makeAuthenticatedLayer } from "./routes/authenticated.js";
import { makeHealthLayer, makePublicLayer } from "./routes/public.js";
import { serverRuntime } from "./runtime.js";

type WebHandler = {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
};

let handlerPromise: Promise<WebHandler> | undefined;

async function createHandler() {
  const baseApi = HttpApi.make("dfg")
    .add(healthGroup)
    .add(publicGroup)
    .add(authGroup)
    .add(authenticatedGroup)
    .add(adminGroup)
    .add(materialDownloadGroup);

  const baseRouteLayers = [
    makeHealthLayer(),
    makePublicLayer(),
    makeAuthLayer(),
    makeAuthenticatedLayer(),
    makeAdminLayer(),
    makeMaterialDownloadLayer(),
  ] as const;
  if (env.NODE_ENV !== "production") {
    const { makeTestingLayer, testingGroup } = await import("./routes/testing.js");
    const { TestingService } = await import("./services/testingService.js");
    const api = baseApi.add(testingGroup);
    const apiLayer = HttpApiBuilder.layer(api).pipe(
      Layer.provide(Layer.mergeAll(...baseRouteLayers, makeTestingLayer())),
      HttpRouter.provideRequest(TestingService.layer),
    );

    return makeWebHandler(apiLayer);
  }

  const apiLayer = HttpApiBuilder.layer(baseApi).pipe(
    Layer.provide(Layer.mergeAll(...baseRouteLayers)),
  );

  return makeWebHandler(apiLayer);
}

type ApplicationServices = ManagedRuntime.ManagedRuntime.Services<typeof serverRuntime>;

// Route layers need the application services when they are built, and handlers need them again per request.
type RouteRequirements =
  | HttpRouter.HttpRouter
  | ApplicationServices
  | HttpRouter.Request<"Requires", ApplicationServices>;

async function makeWebHandler(
  apiLayer: Layer.Layer<never, never, RouteRequirements>,
): Promise<WebHandler> {
  const services = await serverRuntime.context();
  const web = HttpRouter.toWebHandler(
    apiLayer.pipe(Layer.provide(Layer.succeedContext(services))),
    {
      disableLogger: true,
    },
  );
  return {
    handler: (request) => web.handler(request, services),
    dispose: web.dispose,
  };
}

async function getWebHandler() {
  if (!handlerPromise) {
    handlerPromise = createHandler();
  }

  return handlerPromise;
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const handler = await getWebHandler();
  return handler.handler(request);
}

export async function disposeApiHandler(): Promise<void> {
  const handler = handlerPromise;
  handlerPromise = undefined;
  await (await handler)?.dispose();
  await serverRuntime.dispose();
}
