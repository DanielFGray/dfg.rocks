import { Config, Effect, Layer } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Etag from "effect/http/Etag";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as BunRedis from "@effect/platform-bun/BunRedis";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import { Contract } from "../shared/httpApi.js";
import { makeAuthLayer } from "./api/auth.js";
import { CoursesApiGroupLive, CoursesAdminApiGroupLive } from "./api/courses.js";
import { MaterialsApiGroupLive, MaterialsAdminApiGroupLive } from "./api/materials.js";
import { PracticeApiGroupLive, PracticeAdminApiGroupLive } from "./api/practice.js";
import { MessagesApiGroupLive } from "./api/messages.js";
import { LessonsApiGroupLive, LessonsAdminApiGroupLive } from "./api/lessons.js";
import { AccountsApiGroupLive } from "./api/accounts.js";
import { TestimonialsApiGroupLive, TestimonialsAdminApiGroupLive } from "./api/testimonials.js";
import { FamiliesApiGroupLive, FamiliesAdminApiGroupLive } from "./api/families.js";
import { RealtimeApiGroupLive } from "./api/realtime.js";
import { CalendarConnectAdminApiGroupLive, CalendarAdminApiGroupLive } from "./api/calendar.js";
import { GuardsLive } from "./api/guards.js";
import { StudentsStaffApiGroupLive, StudentsAdminApiGroupLive } from "./api/students.js";
import { MonthlyBillingAdminApiGroupLive } from "./api/monthlyBilling.js";
import { PayersAdminApiGroupLive } from "./api/payers.js";
import { BillsAdminApiGroupLive } from "./api/bills.js";
import { PaymentsAdminApiGroupLive } from "./api/payments.js";
import { CreditsAdminApiGroupLive } from "./api/credits.js";
import { BillingRatesAdminApiGroupLive } from "./api/billingRates.js";
import { makeFamilyBillingLayer } from "./api/familyBilling.js";
import { makeHealthLayer } from "./api/health.js";
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
import { ContactService } from "./services/contactService.js";
import { OAuthService } from "./services/oauthService.js";
import { PdfService } from "./services/pdfService.js";
import { RateLimitService } from "./rateLimit.js";
import { RateLimiterValkey } from "./services/rateLimiter.js";
import { RecurringScheduleService } from "./services/recurringScheduleService.js";
import { RealtimeService } from "./services/realtimeService.js";
import { CourseService } from "./services/courseService.js";
import { FamilyService } from "./services/familyService.js";
import { AccountService } from "./services/accountService.js";
import { TestimonialService } from "./services/testimonialService.js";
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

const billingServicesLayer = FamilyBillingService.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(PdfService.layer, BillingLedgerService.layer)),
);

const servicesLayer = Layer.mergeAll(
  RealtimeService.layer,
  GoogleCalendarService.layer,
  SessionService.layer,
  lessonServicesLayer,
  AuthService.layer,
  AuthRouteService.layer,
  billingServicesLayer,
  rateLimitLayer,
  FileService.layer,
  GeolocationService.layer,
  ContactService.layer,
  OAuthService.layer,
  TestimonialService.layer,
  AccountService.layer,
  FamilyService.layer,
  CourseService.layer,
  StorageService.layer,
  TestimonialReminderService.layer,
  UserService.layer,
).pipe(Layer.provideMerge(infrastructureLayer));

/** The services every request and server function uses, without the job runner. */
export const applicationLayer = servicesLayer;

/** The services of the server process: the application services and the job runner. */
export type AppServices = Layer.Success<typeof applicationLayer> | BackgroundWorker;

const GroupHandlersLive = Layer.mergeAll(
  makeHealthLayer(),
  makePublicLayer(),
  makeAuthLayer(),
  CoursesApiGroupLive,
  CoursesAdminApiGroupLive,
  MaterialsApiGroupLive,
  MaterialsAdminApiGroupLive,
  PracticeApiGroupLive,
  PracticeAdminApiGroupLive,
  MessagesApiGroupLive,
  LessonsApiGroupLive,
  LessonsAdminApiGroupLive,
  AccountsApiGroupLive,
  TestimonialsApiGroupLive,
  TestimonialsAdminApiGroupLive,
  FamiliesApiGroupLive,
  FamiliesAdminApiGroupLive,
  RealtimeApiGroupLive,
  CalendarConnectAdminApiGroupLive,
  CalendarAdminApiGroupLive,
  StudentsStaffApiGroupLive,
  StudentsAdminApiGroupLive,
  MonthlyBillingAdminApiGroupLive,
  PayersAdminApiGroupLive,
  BillsAdminApiGroupLive,
  PaymentsAdminApiGroupLive,
  CreditsAdminApiGroupLive,
  BillingRatesAdminApiGroupLive,
  makeFamilyBillingLayer(),
);

const ApiLive = HttpApiBuilder.layer(Contract).pipe(
  Layer.provide(GroupHandlersLive),
  Layer.provide(GuardsLive),
);

/** The testing routes are imported only outside production, so the production bundle never loads them. */
const TestingMountLive = Layer.unwrap(
  Effect.gen(function* () {
    if ((yield* Config.String("NODE_ENV")) === "production") return Layer.empty;
    const { TestingHttpApiLive } = yield* Effect.promise(() => import("./api/testing.js"));
    return TestingHttpApiLive;
  }),
);

/** Every /api route. Handlers find the services they use per request. */
export const HttpApiLive = Layer.mergeAll(ApiLive, TestingMountLive);
