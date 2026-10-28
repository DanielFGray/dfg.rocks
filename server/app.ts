import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApp from "@effect/platform/HttpApp";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import { authGroup, publicGroup } from "../shared/httpApi.js";
import { env } from "./assertEnv.js";
import {
  makeAdminLayer,
  adminGroup,
  makeMaterialDownloadLayer,
  materialDownloadGroup,
} from "./routes/admin.js";
import { makeAuthLayer } from "./routes/auth.js";
import { authenticatedGroup, makeAuthenticatedLayer } from "./routes/authenticated.js";
import { makePublicLayer } from "./routes/public.js";
import { serverRuntime } from "./runtime.js";

type WebHandler = (request: Request) => Promise<Response>;

let handlerPromise: Promise<WebHandler> | undefined;

async function createHandler() {
  const baseApi = HttpApi.make("dfg")
    .add(publicGroup)
    .add(authGroup)
    .add(authenticatedGroup)
    .add(adminGroup)
    .add(materialDownloadGroup);

  const baseRouteLayers = [
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
    const apiLayer = HttpApiBuilder.api(api).pipe(
      Layer.provide([...baseRouteLayers, makeTestingLayer()] as const),
      Layer.provide(TestingService.Default),
    );

    return makeWebHandler(apiLayer);
  }

  const apiLayer = HttpApiBuilder.api(baseApi).pipe(Layer.provide(baseRouteLayers));

  return makeWebHandler(apiLayer);
}

type ApplicationServices = ManagedRuntime.ManagedRuntime.Context<typeof serverRuntime>;

async function makeWebHandler(
  apiLayer: Layer.Layer<HttpApi.Api, never, ApplicationServices>,
) {
  const handlerLayer = Layer.mergeAll(
    apiLayer,
    HttpApiBuilder.Router.Live,
    HttpApiBuilder.Middleware.layer,
  );
  const httpApp = await serverRuntime.runPromise(
    HttpApiBuilder.httpApp.pipe(Effect.provide(handlerLayer)),
  );
  const runtime = await serverRuntime.runtime();
  return HttpApp.toWebHandlerRuntime(runtime)(httpApp);
}

async function getWebHandler() {
  if (!handlerPromise) {
    handlerPromise = createHandler();
  }

  return handlerPromise;
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const handler = await getWebHandler();
  return handler(request);
}

export async function disposeApiHandler(): Promise<void> {
  handlerPromise = undefined;
  await serverRuntime.dispose();
}
