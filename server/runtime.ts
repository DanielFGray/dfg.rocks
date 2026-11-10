import { Config, Effect, Layer, ManagedRuntime } from "effect";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Etag from "effect/http/Etag";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as BunRedis from "@effect/platform-bun/BunRedis";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import { authGroup, healthGroup, publicGroup } from "../shared/httpApi.js";
import { adminGroup, makeAdminLayer } from "./api/admin.js";
import { makeAuthLayer } from "./api/auth.js";
import { authenticatedGroup, makeAuthenticatedLayer } from "./api/authenticated.js";
import { makeHealthLayer } from "./api/health.js";
import { makeMaterialDownloadLayer, materialDownloadGroup } from "./api/materialDownload.js";
import { makePublicLayer } from "./api/public.js";
import { PgAuthDB, PgRootDB } from "./db.js";
import { AdminRouteService } from "./services/adminRouteService.js";
import { AuthenticatedRouteService } from "./services/authenticatedRouteService.js";
import { AuthRouteService } from "./services/authRouteService.js";
import { AuthService } from "./services/authService.js";
import { BackgroundWorker } from "./services/backgroundWorker.js";
import { BillingLedgerService } from "./services/billingLedgerService.js";
import { FileService } from "./services/fileService.js";
import { FamilyBillingService } from "./services/familyBillingService.js";
import { GeolocationService } from "./services/geolocation.js";
import { GoogleCalendarService } from "./services/googleCalendarService.js";
import { LessonPolicyService } from "./services/lessonPolicyService.js";
import { PublicRouteService } from "./services/publicRouteService.js";
import { PdfService } from "./services/pdfService.js";
import { RateLimitService } from "./rateLimit.js";
import { RateLimiterValkey } from "./services/rateLimiter.js";
import { RecurringScheduleService } from "./services/recurringScheduleService.js";
import { RealtimeService } from "./services/realtimeService.js";
import { SessionService } from "./services/sessionService.js";
import { StorageService } from "./services/storageService.js";
import { TestimonialReminderService } from "./services/testimonialReminderService.js";
import { UserService } from "./services/userService.js";

const infrastructureLayer = Layer.mergeAll(
  NodeHttpPlatform.layer,
  NodeFileSystem.layer,
  NodePath.layer,
  Etag.layer,
  FetchHttpClient.layer,
  PgRootDB.Live,
  PgAuthDB.Live,
);

// Outside production, E2E browsers share one address, so a real limiter would throttle the suite.
const rateLimitLayer = Layer.unwrap(
  Effect.map(Config.String("NODE_ENV"), (nodeEnv) =>
    nodeEnv === "production"
      ? RateLimitService.Live.pipe(
          Layer.provide(RateLimiterValkey),
          // Bun's client connects on first use, so the server starts while Valkey is down.
          // By default the client stops after a few reconnect attempts and stays closed
          // when Valkey returns, and it holds commands while it reconnects. With these
          // options it keeps reconnecting, and a command fails at once while Valkey is
          // down, so each rule applies its whenStoreDown policy without waiting.
          Layer.provide(
            BunRedis.layerConfig({
              url: Config.String("VALKEY_URL"),
              maxRetries: Config.succeed(1_000_000),
              enableOfflineQueue: Config.succeed(false),
            }),
          ),
        )
      : RateLimitService.Test,
  ),
);

const lessonServicesLayer = Layer.mergeAll(
  AdminRouteService.layer,
  AuthenticatedRouteService.layer,
  RecurringScheduleService.layer,
).pipe(Layer.provideMerge(LessonPolicyService.layer));

const billingServicesLayer = Layer.mergeAll(
  PdfService.layer,
  BillingLedgerService.layer,
  FamilyBillingService.layer.pipe(
    Layer.provide(Layer.mergeAll(PdfService.layer, BillingLedgerService.layer)),
  ),
);

const servicesLayer = Layer.mergeAll(
  RealtimeService.layer,
  GoogleCalendarService.layer,
  SessionService.layer,
  lessonServicesLayer,
  AuthService.layer,
  AuthRouteService.layer,
  BackgroundWorker.Live,
  billingServicesLayer,
  rateLimitLayer,
  FileService.layer,
  GeolocationService.layer,
  PublicRouteService.layer,
  StorageService.layer,
  TestimonialReminderService.layer,
  UserService.layer,
).pipe(Layer.provideMerge(infrastructureLayer));

export const applicationLayer = servicesLayer;

/**
 * Server functions run on serverRuntime, and the /api handler in app.ts builds HttpApiLive. Both
 * build from this memo map, so each service, pool and job runner exists once per process.
 */
export const memoMap = Layer.makeMemoMapUnsafe();

export const serverRuntime = ManagedRuntime.make(applicationLayer, { memoMap });

const ServerApi = HttpApi.make("dfg")
  .add(healthGroup)
  .add(publicGroup)
  .add(authGroup)
  .add(authenticatedGroup)
  .add(adminGroup)
  .add(materialDownloadGroup);

const GroupHandlersLive = Layer.mergeAll(
  makeHealthLayer(),
  makePublicLayer(),
  makeAuthLayer(),
  makeAuthenticatedLayer(),
  makeAdminLayer(),
  makeMaterialDownloadLayer(),
);

const ApiLive = HttpApiBuilder.layer(ServerApi).pipe(Layer.provide(GroupHandlersLive));

/** The testing routes are imported only outside production, so the production bundle never loads them. */
const TestingMountLive = Layer.unwrap(
  Effect.gen(function* () {
    if ((yield* Config.String("NODE_ENV")) === "production") return Layer.empty;
    const { TestingHttpApiLive } = yield* Effect.promise(() => import("./api/testing.js"));
    return TestingHttpApiLive;
  }),
);

/** Every /api route, with the application services merged in so handlers find them per request. */
export const HttpApiLive = Layer.mergeAll(ApiLive, TestingMountLive).pipe(
  Layer.provideMerge(applicationLayer),
);
