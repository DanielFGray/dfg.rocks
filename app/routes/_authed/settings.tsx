import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getSettingsPageData } from "../../lib/routeData.js";
import { AdminSection } from "../../components/settings/AdminSection.js";
import { EmailSection } from "../../components/settings/EmailSection.js";
import { TestimonialEditor } from "../../components/testimonials/TestimonialEditor.js";

export const Route = createFileRoute("/_authed/settings")({
  loader: () => getSettingsPageData(),
  head: () => ({ meta: [{ title: "Settings | DFG Portal" }] }),
  component: SettingsPage,
  pendingComponent: () => (
    <main className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 text-muted dark:text-muted-dark md:px-8">
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
          onRefresh={() => void router.invalidate()}
        />
      ) : (
        <div className="mb-8">
          <TestimonialEditor
            testimonial={testimonial}
            onRefresh={() => void router.invalidate()}
            mode="settings"
          />
        </div>
      )}

      <EmailSection emails={emails} onRefresh={() => void router.invalidate()} />
    </main>
  );
}
