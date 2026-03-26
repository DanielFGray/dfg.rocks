import { createFileRoute } from "@tanstack/react-router";
import { myEmailsQuery, gcalStatusQuery, workingHoursQuery } from "../../lib/queries.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { AdminSection } from "../../components/settings/AdminSection.js";
import { EmailSection } from "../../components/settings/EmailSection.js";

export const Route = createFileRoute("/_authed/settings")({
  loader: async ({ context: { queryClient, isAdmin } }) => {
    if (isAdmin) {
      await Promise.allSettled([
        queryClient.ensureQueryData(myEmailsQuery),
        queryClient.ensureQueryData(gcalStatusQuery),
        queryClient.ensureQueryData(workingHoursQuery),
      ]);
    } else {
      await queryClient.ensureQueryData(myEmailsQuery);
    }
  },
  head: () => ({ meta: [{ title: "Settings | DFG Portal" }] }),
  component: SettingsPage,
  pendingComponent: () => (
    <main className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16 text-muted">Loading...</main>
  ),
});

function SettingsPage() {
  const { isAdmin } = useAuth();

  return (
    <main data-pwid="settings" className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16">
      <h1 className="text-3xl font-bold tracking-tight mb-8">Account Settings</h1>

      {/* Google Calendar + Working Hours section (admin only) */}
      {isAdmin ? <AdminSection /> : null}

      {/* Email Addresses section */}
      <EmailSection />
    </main>
  );
}
