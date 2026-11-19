import { Config, Effect, Layer } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Etag from "effect/http/Etag";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as BunRedis from "@effect/platform-bun/BunRedis";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodePath from "@effect/platform-node/NodePath";
import { Contract } from "../shared/httpApi.js";
import { AuthApiGroupLive } from "./api/auth.js";
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
import { StudentsAdminApiGroupLive } from "./api/students.js";
import { PeopleStaffApiGroupLive, PeopleAdminApiGroupLive } from "./api/people.js";
import { MonthlyBillingAdminApiGroupLive } from "./api/monthlyBilling.js";
import { PayersAdminApiGroupLive } from "./api/payers.js";
import { BillsAdminApiGroupLive } from "./api/bills.js";
import { PaymentsAdminApiGroupLive } from "./api/payments.js";
import { CreditsAdminApiGroupLive } from "./api/credits.js";
import { BillingRatesAdminApiGroupLive } from "./api/billingRates.js";
import { FamilyBillingApiGroupLive } from "./api/familyBilling.js";
import { SubscriptionsApiGroupLive } from "./api/subscriptions.js";
import { HealthApiGroupLive } from "./api/health.js";
import { PublicApiGroupLive } from "./api/public.js";
import { PgAuthDB, PgRootDB } from "./db.js";
import { ValkeyReady } from "./dependencies.js";
import { Lessons } from "./services/lessons.js";
import { Auth } from "./services/auth.js";
import { Worker } from "../worker/worker.js";
import type { InProcessApi } from "./inProcessApi.js";
import { BillingLedger } from "./services/billingLedger.js";
import { Files } from "./services/files.js";
import { FamilyBilling } from "./services/familyBilling.js";
import { Stripe } from "./services/stripe.js";
import { StripeWebhook } from "./services/stripeWebhook.js";
import { GoogleCalendar } from "./services/googleCalendar.js";
import { LessonPolicy } from "./services/lessonPolicy.js";
import { Contact } from "./services/contact.js";
import { OAuth } from "./services/oauth.js";
import { Pdf } from "./services/pdf.js";
import { RateLimit } from "./rateLimit.js";
import { RecurringSchedule } from "./services/recurringSchedule.js";
import { Realtime } from "./services/realtime.js";
import { Messages } from "./services/messages.js";
import { Practice } from "./services/practice.js";
import { Materials } from "./services/materials.js";
import { Courses } from "./services/courses.js";
import { Families } from "./services/families.js";
import { Account } from "./services/account.js";
import { Testimonials } from "./services/testimonials.js";
import { Sessions } from "./services/sessions.js";
import { Storage } from "./services/storage.js";
import { TestimonialReminder } from "./services/testimonialReminder.js";
import { Users } from "./services/users.js";
import { Students } from "./services/students.js";
import { People } from "./services/people.js";

const infrastructureLayer = Layer.mergeAll(
  NodeHttpPlatform.layer,
  NodeFileSystem.layer,
  NodePath.layer,
  Etag.layer,
  FetchHttpClient.layer,
  PgRootDB.layer,
  PgAuthDB.layer,
);

// By default Bun's client stops after a few reconnect attempts and stays
// closed when Valkey returns, and it holds commands while it reconnects.
// With these options it keeps reconnecting, and a command fails at once
// while it is not connected, so a request does not wait on an outage. The
// client connects on first use; the boot waits for it (ValkeyReady).
const valkeyClient = BunRedis.layerConfig({
  url: Config.String("VALKEY_URL"),
  maxRetries: Config.succeed(1_000_000),
  enableOfflineQueue: Config.succeed(false),
});

const rateLimiterWithValkey = Layer.mergeAll(ValkeyReady, RateLimit.layer).pipe(
  Layer.provide(valkeyClient),
);

const rateLimitLayer = Layer.unwrap(
  Effect.map(Config.String("NODE_ENV"), (mode) =>
    mode === "production" ? rateLimiterWithValkey : RateLimit.layerTest,
  ),
);

// E2E runs (NODE_ENV=test) answer Stripe's HTTP calls from a fake, so the test server never sends a
// request to Stripe. The fake module loads only then, as the testing routes do.
const stripeLayer = Layer.unwrap(
  Effect.gen(function* () {
    if ((yield* Config.String("NODE_ENV")) !== "test") return Stripe.layer;
    const { stripeFakeHttp } = yield* Effect.promise(() => import("./services/stripeFake.js"));
    return Stripe.layerWithHttp(stripeFakeHttp);
  }),
);

const servicesLayer = Layer.mergeAll(
  Realtime.layer,
  GoogleCalendar.layer,
  Sessions.layer,
  Lessons.layer,
  RecurringSchedule.layer,
  LessonPolicy.layer,
  Auth.layer,
  FamilyBilling.layer,
  stripeLayer,
  StripeWebhook.layer,
  Pdf.layer,
  BillingLedger.layer,
  rateLimitLayer,
  Files.layer,
  Contact.layer,
  OAuth.layer,
  Testimonials.layer,
  Account.layer,
  Families.layer,
  Courses.layer,
  Materials.layer,
  Practice.layer,
  Messages.layer,
  Storage.layer,
  TestimonialReminder.layer,
  Users.layer,
  Students.layer,
  People.layer,
).pipe(Layer.provideMerge(infrastructureLayer));

/** The services every request and server function uses, without the job runner. */
export const applicationLayer = servicesLayer;

/** The services the API handler runs on: the application services and the job runner. */
export type ApplicationServices = Layer.Success<typeof applicationLayer> | Worker;

/** The services of the server process: those of the API handler, and the API in this process. */
export type AppServices = ApplicationServices | InProcessApi;

const GroupHandlersLive = Layer.mergeAll(
  HealthApiGroupLive,
  PublicApiGroupLive,
  AuthApiGroupLive,
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
  PeopleStaffApiGroupLive,
  PeopleAdminApiGroupLive,
  StudentsAdminApiGroupLive,
  MonthlyBillingAdminApiGroupLive,
  PayersAdminApiGroupLive,
  BillsAdminApiGroupLive,
  PaymentsAdminApiGroupLive,
  CreditsAdminApiGroupLive,
  BillingRatesAdminApiGroupLive,
  FamilyBillingApiGroupLive,
  SubscriptionsApiGroupLive,
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
