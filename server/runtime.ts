import { Layer, ManagedRuntime } from "effect";
import * as Etag from "@effect/platform/Etag";
import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import { PgAuthDB, PgRootDB } from "./db.js";
import { env } from "./assertEnv.js";
import { AdminRouteService } from "./services/adminRouteService.js";
import { AuthenticatedRouteService } from "./services/authenticatedRouteService.js";
import { AuthRouteService } from "./services/authRouteService.js";
import { AuthService } from "./services/authService.js";
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
import { StorageService } from "./services/storageService.js";
import { TestimonialReminderService } from "./services/testimonialReminderService.js";
import { UserService } from "./services/userService.js";

// Expose the root PgClient alongside its Kysely wrapper so scoped services such
// as RealtimeService share the same pool instead of acquiring another one.
const rootDatabaseLayer = PgRootDB.Kysely.pipe(Layer.provideMerge(PgRootDB.Conn));

const infrastructureLayer = Layer.mergeAll(
  NodeHttpPlatform.layer,
  NodeFileSystem.layer,
  NodePath.layer,
  Etag.layer,
  FetchHttpClient.layer,
  rootDatabaseLayer,
  PgAuthDB.Live,
);

// Outside production, E2E browsers share one address, so a real limiter would throttle the suite.
const rateLimitLayer = env.NODE_ENV === "production" ? RateLimitService.Live : RateLimitService.Test;

const lessonServicesLayer = Layer.mergeAll(
  AdminRouteService.Default,
  AuthenticatedRouteService.Default,
  RecurringScheduleService.Default,
).pipe(Layer.provideMerge(LessonPolicyService.Default));

const billingServicesLayer = Layer.mergeAll(
  PdfService.Default,
  BillingLedgerService.Default,
  FamilyBillingService.Default.pipe(
    Layer.provide(Layer.mergeAll(PdfService.Default, BillingLedgerService.Default)),
  ),
);

const servicesLayer = Layer.mergeAll(
  RealtimeService.Default,
  GoogleCalendarService.Default,
  SessionService.Default,
  lessonServicesLayer,
  AuthService.Default,
  AuthRouteService.Default,
  billingServicesLayer,
  rateLimitLayer,
  FileService.Default,
  GeolocationService.Default,
  PublicRouteService.Default,
  StorageService.Live,
  TestimonialReminderService.Default,
  UserService.Default,
).pipe(Layer.provideMerge(infrastructureLayer));

export const applicationLayer = servicesLayer;

export const serverRuntime = ManagedRuntime.make(applicationLayer);
