import { Effect } from "effect";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { getErrorMessage } from "../../lib/errors.js";
import type { PendingInvitation } from "../../../shared/api/invitations.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/** Invited accounts whose owner has not followed the link yet, each with a resend button. */
export function PendingInvitations({
  invitations,
  onResent,
}: {
  invitations: readonly PendingInvitation[];
  onResent: () => void;
}) {
  const resend = useMutation({
    mutationFn: (id: string) =>
      Effect.runPromise(api.invitationsStaff.resendInvitation({ params: { id } })),
    onSuccess: onResent,
  });

  if (invitations.length === 0) return null;

  return (
    <section data-testid="pending-invitations" className="mb-8">
      <h2 className="mb-3 text-lg font-semibold">Pending invites</h2>
      {resend.isError ? (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">
          {getErrorMessage(resend.error, "Could not resend the invitation")}
        </p>
      ) : null}
      <div className="flex flex-col gap-3">
        {invitations.map((invitation) => {
          const expired = invitation.expires_at !== null && invitation.expires_at < new Date();
          return (
            <Card key={invitation.id}>
              <div
                data-testid={`pending-invitation-${invitation.username}`}
                className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <Link
                    to="/people/$id"
                    params={{ id: invitation.user_id }}
                    className="font-semibold text-primary no-underline hover:text-accent"
                  >
                    {invitation.name ?? invitation.username}
                  </Link>
                  <span className="ml-3 text-sm text-muted">
                    {invitation.email}
                  </span>
                  <p className="mt-1 text-xs text-muted">
                    Sent {dateFormat.format(invitation.created_at)}
                    {invitation.invited_by_name ? ` by ${invitation.invited_by_name}` : ""}
                    {invitation.expires_at
                      ? ` · ${expired ? "expired" : "expires"} ${dateFormat.format(invitation.expires_at)}`
                      : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => resend.mutate(invitation.id)}
                  disabled={resend.isPending && resend.variables === invitation.id}
                  data-testid={`resend-invitation-${invitation.username}`}
                >
                  {resend.isSuccess && resend.variables === invitation.id ? "Sent again" : "Resend"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
