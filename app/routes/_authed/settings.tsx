import { Effect } from "effect";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { AdminSection } from "../../components/settings/AdminSection.js";
import { EmailSection } from "../../components/settings/EmailSection.js";
import { DeleteAccountSection } from "../../components/settings/DeleteAccountSection.js";
import { TestimonialEditor } from "../../components/testimonials/TestimonialEditor.js";
import { serverRuntime } from "../../../server/runtime.js";
import { AdminRouteService } from "../../../server/services/adminRouteService.js";
import { AuthenticatedRouteService } from "../../../server/services/authenticatedRouteService.js";
import { GoogleCalendarService } from "../../../server/services/googleCalendarService.js";
import { TestimonialReminderService } from "../../../server/services/testimonialReminderService.js";
import { serializeUserEmail, serializeTestimonial } from "../../../shared/responseMappers.js";
import { toServerFunctionPayload } from "../../lib/serverFunctionPayload.js";
import { requireSession } from "../../lib/sessionGuards.server.js";

const getSettingsPageData = createServerFn({ method: "GET" }).handler(() =>
  serverRuntime.runPromise(
    Effect.gen(function* () {
      const session = yield* requireSession(getCookie("session"));

      const emailsEffect = AuthenticatedRouteService.use((authenticatedRouteService) =>
        authenticatedRouteService.myEmails(session.session.id),
      );

      if (session.user.role !== "admin") {
        const [emails, testimonial] = yield* Effect.all([
          emailsEffect,
          AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.testimonial(session.session.id, session.user.id),
          ),
        ]);

        return toServerFunctionPayload({
          emails: emails.map(serializeUserEmail),
          testimonial: testimonial ? serializeTestimonial(testimonial) : null,
          gcalStatus: null,
          workingHours: null,
          testimonialReminderIntervalDays: null,
          adminTestimonials: null,
        });
      }

      const [emails, gcalStatus, workingHours, intervalDays, adminTestimonials] = yield* Effect.all(
        [
          emailsEffect,
          AdminRouteService.use((adminRouteService) => adminRouteService.getGoogleCalendarStatus()),
          GoogleCalendarService.use((googleCalendarService) =>
            googleCalendarService.getWorkingHours(),
          ),
          TestimonialReminderService.use((testimonialReminderService) =>
            testimonialReminderService.getIntervalDays(),
          ),
          AdminRouteService.use((adminRouteService) =>
            adminRouteService.listTestimonials(session.session.id),
          ),
        ],
      );

      return toServerFunctionPayload({
        emails: emails.map(serializeUserEmail),
        testimonial: null,
        gcalStatus: {
          connected: gcalStatus.connected,
          calendar_id: typeof gcalStatus.calendar_id === "string" ? gcalStatus.calendar_id : null,
        },
        workingHours,
        testimonialReminderIntervalDays: intervalDays,
        adminTestimonials: adminTestimonials.map(serializeTestimonial),
      });
    }),
  ),
);

export const Route = createFileRoute("/_authed/settings")({
  loader: () => getSettingsPageData(),
  head: () => ({ meta: [{ title: "Settings | DFG Portal" }] }),
  component: SettingsPage,
  pendingComponent: () => (
    <main className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 text-muted md:px-8 dark:text-muted-dark">
      Loading...
    </main>
  ),
});

function SettingsPage() {
  const router = useRouter();
  const {
    emails,
    testimonial,
    gcalStatus,
    workingHours,
    testimonialReminderIntervalDays,
    adminTestimonials,
  } = Route.useLoaderData();
  const isAdmin = gcalStatus !== null && workingHours !== null;

  return (
    <main data-testid="settings" className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 md:px-8">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Account Settings</h1>

      {isAdmin ? (
        <AdminSection
          gcalStatus={gcalStatus}
          workingHoursData={workingHours}
          testimonialReminderIntervalDays={testimonialReminderIntervalDays ?? 30}
          testimonials={adminTestimonials ?? []}
          onRefresh={() => router.invalidate()}
        />
      ) : (
        <div className="mb-8">
          <TestimonialEditor
            testimonial={testimonial}
            onRefresh={() => router.invalidate()}
            mode="settings"
          />
        </div>
      )}

      <EmailSection emails={emails} onRefresh={() => router.invalidate()} />

      <DeleteAccountSection onRefresh={() => router.invalidate()} />
    </main>
  );
}
