import { Effect } from "effect";
import { withAuthContext } from "../../../server/requestDatabase.js";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { AdminSection } from "../../components/settings/AdminSection.js";
import { EmailSection } from "../../components/settings/EmailSection.js";
import { DeleteAccountSection } from "../../components/settings/DeleteAccountSection.js";
import { SubscriptionSettings } from "../../components/subscriptions/SubscriptionSettings.js";
import { TestimonialEditor } from "../../components/testimonials/TestimonialEditor.js";
import { runServerEffect } from "../../lib/serverEffect.js";
import { Account } from "../../../server/services/account.js";
import { Testimonials } from "../../../server/services/testimonials.js";
import { GoogleCalendar } from "../../../server/services/googleCalendar.js";
import { TestimonialReminder } from "../../../server/services/testimonialReminder.js";
import { serializeUserEmail, serializeTestimonial } from "../../../shared/responseMappers.js";
import { Sessions } from "../../../server/services/sessions.js";

const getSettingsPageData = createServerFn({ method: "GET" }).handler(() =>
  runServerEffect(
    Effect.gen(function* () {
      const session = yield* Sessions.use((sessions) =>
        sessions.requireSession(getCookie("session")),
      );
      return yield* Effect.gen(function* () {
        const emailsEffect = Account.use((accountService) => accountService.myEmails());

        if (session.user.role !== "admin") {
          const [emails, testimonial] = yield* Effect.all([
            emailsEffect,
            Testimonials.use((testimonialService) =>
              testimonialService.testimonial(session.user.id),
            ),
          ]);

          return {
            emails: emails.map(serializeUserEmail),
            testimonial: testimonial ? serializeTestimonial(testimonial) : null,
            gcalStatus: null,
            workingHours: null,
            testimonialReminderIntervalDays: null,
            adminTestimonials: null,
          };
        }

        const [emails, gcalStatus, workingHours, intervalDays, adminTestimonials] =
          yield* Effect.all([
            emailsEffect,
            GoogleCalendar.use((googleCalendarService) =>
              googleCalendarService.getGoogleCalendarStatus(),
            ),
            GoogleCalendar.use((googleCalendarService) => googleCalendarService.getWorkingHours()),
            TestimonialReminder.use((testimonialReminderService) =>
              testimonialReminderService.getIntervalDays(),
            ),
            Testimonials.use((testimonialService) => testimonialService.listTestimonials()),
          ]);

        return {
          emails: emails.map(serializeUserEmail),
          testimonial: null,
          gcalStatus: {
            connected: gcalStatus.connected,
            calendar_id: typeof gcalStatus.calendar_id === "string" ? gcalStatus.calendar_id : null,
          },
          workingHours,
          testimonialReminderIntervalDays: intervalDays,
          adminTestimonials: adminTestimonials.map(serializeTestimonial),
        };
      }).pipe(withAuthContext(session.session.id));
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

      <SubscriptionSettings />

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
            key={testimonial?.id ?? "new"}
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
