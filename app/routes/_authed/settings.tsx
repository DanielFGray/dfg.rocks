import { createFileRoute, useRouter } from "@tanstack/react-router";
import type { UserEmail, WorkingHours } from "../../lib/types.js";
import { getSettingsPageData } from "../../lib/routeData.js";
import { AdminSection } from "../../components/settings/AdminSection.js";
import { EmailSection } from "../../components/settings/EmailSection.js";
import { TestimonialEditor } from "../../components/testimonials/TestimonialEditor.js";

export const Route = createFileRoute("/_authed/settings")({
  loader: () => getSettingsPageData(),
  head: () => ({ meta: [{ title: "Settings | DFG Portal" }] }),
  component: SettingsPage,
  pendingComponent: () => (
    <main className="px-5 md:px-8 pt-20 pb-16 text-muted dark:text-muted-dark mx-auto max-w-[1100px]">
      Loading...
    </main>
  ),
});

function SettingsPage() {
  const router = useRouter();
  const { emails, testimonial, gcalStatus, workingHours, testimonialReminderIntervalDays } =
    Route.useLoaderData();
  const isAdmin = gcalStatus !== null && workingHours !== null;

  return (
    <main data-testid="settings" className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]">
      <h1 className="text-3xl font-bold tracking-tight mb-8">Account Settings</h1>

      {/* Google Calendar + Working Hours section (admin only) */}
      {isAdmin ? (
        <AdminSection
          gcalStatus={gcalStatus}
          workingHoursData={workingHours}
          testimonialReminderIntervalDays={testimonialReminderIntervalDays ?? 30}
          onRefresh={() => void router.invalidate()}
        />
      ) : null}

      {!isAdmin ? (
        <div className="mb-8">
          <TestimonialEditor
            testimonial={testimonial}
            onRefresh={() => void router.invalidate()}
            mode="settings"
          />
        </div>
      ) : null}

      {/* Email Addresses section */}
      <EmailSection emails={emails} onRefresh={() => void router.invalidate()} />
    </main>
  );
}
