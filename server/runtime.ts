import { Layer, ManagedRuntime } from "effect";
import * as Etag from "effect/http/Etag";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import { PgAuthDB, PgRootDB } from "./db.js";
import { env } from "./assertEnv.js";
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
import { RateLimitService } from "./services/rateLimiter.js";
import { RecurringScheduleService } from "./services/recurringScheduleService.js";
import { RealtimeService } from "./services/realtimeService.js";
import { SessionService } from "./services/sessionService.js";
import { StaticScoreService } from "./services/staticScoreService.js";
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
const rateLimitLayer =
  env.NODE_ENV === "production" ? RateLimitService.Live : RateLimitService.Test;

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
  StaticScoreService.layer,
  StorageService.layer,
  TestimonialReminderService.layer,
  UserService.layer,
).pipe(Layer.provideMerge(infrastructureLayer));

export const applicationLayer = servicesLayer;

export const serverRuntime = ManagedRuntime.make(applicationLayer);
