import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as Etag from "@effect/platform/Etag";
import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Layer from "effect/Layer";
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
import { PgAuthDB, PgRootDB } from "./db.js";
import { AdminRouteService } from "./services/adminRouteService.js";
import { AuthenticatedRouteService } from "./services/authenticatedRouteService.js";
import { AuthRouteService } from "./services/authRouteService.js";
import { AuthService } from "./services/authService.js";
import { EmailService } from "./services/emailService.js";
import { FileService } from "./services/fileService.js";
import { GoogleCalendarService } from "./services/googleCalendarService.js";
import { NotationService } from "./services/notationService.js";
import { PublicRouteService } from "./services/publicRouteService.js";
import { realtimeService } from "./services/realtimeService.js";
import { SessionService } from "./services/sessionService.js";
import { StorageService } from "./services/storageService.js";
import { UserService } from "./services/userService.js";

type WebHandler = ReturnType<typeof HttpApiBuilder.toWebHandler>;

let handlerPromise: Promise<WebHandler> | undefined;
let realtimeStarted = false;

function startRealtimeOnce() {
  if (realtimeStarted) {
    return;
  }

  realtimeStarted = true;
  realtimeService.start().catch((error: unknown) => {
    console.error("Failed to start realtime service:", error);
  });
}

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
  const infrastructureLayer = Layer.mergeAll(
    NodeHttpPlatform.layer,
    NodeFileSystem.layer,
    NodePath.layer,
    Etag.layer,
    FetchHttpClient.layer,
    PgRootDB.Live,
    PgAuthDB.Live,
  );
  const baseServicesLayer = Layer.mergeAll(
    PublicRouteService.Default,
    AdminRouteService.Default,
    AuthenticatedRouteService.Default,
    AuthRouteService.Default,
    AuthService.Default,
    EmailService.Default,
    FileService.Default,
    GoogleCalendarService.Default,
    NotationService.Default,
    SessionService.Default,
    StorageService.Default,
    UserService.Default,
  );
  const defaultServicesLayer = baseServicesLayer.pipe(
    Layer.provideMerge(infrastructureLayer),
  );

  if (env.NODE_ENV !== "production") {
    const { makeTestingLayer, testingGroup } = await import("./routes/testing.js");
    const { TestingService } = await import("./services/testingService.js");
    const api = baseApi.add(testingGroup);
    const apiLayer = HttpApiBuilder.api(api).pipe(
      Layer.provide([...baseRouteLayers, makeTestingLayer()] as const),
    );
    const servicesLayer = Layer.mergeAll(baseServicesLayer, TestingService.Default).pipe(
      Layer.provideMerge(infrastructureLayer),
    );

    return HttpApiBuilder.toWebHandler(apiLayer.pipe(Layer.provideMerge(servicesLayer)));
  }

  const apiLayer = HttpApiBuilder.api(baseApi).pipe(Layer.provide(baseRouteLayers));

  return HttpApiBuilder.toWebHandler(apiLayer.pipe(Layer.provideMerge(defaultServicesLayer)));
}

async function getWebHandler() {
  if (!handlerPromise) {
    handlerPromise = createHandler();
  }

  return handlerPromise;
}

export async function handleApiRequest(request: Request): Promise<Response> {
  startRealtimeOnce();
  const { handler } = await getWebHandler();
  return handler(request);
}

export async function disposeApiHandler(): Promise<void> {
  if (!handlerPromise) {
    return;
  }

  const { dispose } = await handlerPromise;
  await realtimeService.stop();
  realtimeStarted = false;
  await dispose();
  handlerPromise = undefined;
}
