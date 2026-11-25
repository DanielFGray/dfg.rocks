import { Effect } from "effect";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { getErrorMessage } from "../../lib/errors.js";
import type { UserEmail } from "../../../shared/schemas.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Input } from "../ui/Input.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";

export function EmailSection({
  emails,
  onRefresh,
}: {
  emails: UserEmail[];
  onRefresh: () => Promise<void>;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserEmail | null>(null);

  const addEmailMutation = useMutation({
    mutationFn: (email: string) =>
      Effect.runPromise(api.accounts.addMyEmail({ payload: { email } })),
    onSuccess: onRefresh,
  });

  const makePrimaryMutation = useMutation({
    mutationFn: (id: string) =>
      Effect.runPromise(api.accounts.makePrimaryEmail({ params: { id } })),
    onSuccess: onRefresh,
  });

  const resendVerificationMutation = useMutation({
    mutationFn: (id: string) =>
      Effect.runPromise(api.accounts.resendEmailVerification({ params: { id } })),
  });

  const deleteEmailMutation = useMutation({
    mutationFn: (id: string) => Effect.runPromise(api.accounts.deleteMyEmail({ params: { id } })),
    onSuccess: onRefresh,
  });

  const handleAddEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim();
    if (!email) return;
    setAddError(null);
    try {
      await addEmailMutation.mutateAsync(email);
      // Clear only on success, so a refusal keeps what the user typed.
      setNewEmail("");
    } catch (cause) {
      setAddError(getErrorMessage(cause, "Could not add the email address"));
    }
  };

  return (
    <>
      <section data-testid="email-section">
        <h2 className="mb-4 text-xl font-semibold">Email Addresses</h2>

        <div className="mb-6 flex flex-col gap-3">
          {emails.map((em) => (
            <Card key={em.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-all text-primary">{em.email}</span>
                    {em.is_primary ? (
                      <span
                        data-testid="primary-badge"
                        className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent"
                      >
                        Primary
                      </span>
                    ) : null}
                    {em.is_verified ? (
                      <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-semibold text-green-400">
                        Verified
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-400">
                        Unverified
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {em.is_verified && !em.is_primary ? (
                    <Button
                      variant="ghost"
                      onClick={() => makePrimaryMutation.mutate(em.id)}
                      size="sm"
                      disabled={makePrimaryMutation.isPending}
                      data-testid="make-primary"
                    >
                      Make Primary
                    </Button>
                  ) : null}
                  {!em.is_verified ? (
                    <Button
                      variant="ghost"
                      onClick={() => resendVerificationMutation.mutate(em.id)}
                      size="sm"
                      tone="warning"
                      disabled={resendVerificationMutation.isPending}
                      data-testid="resend-verification"
                    >
                      Resend Verification
                    </Button>
                  ) : null}
                  {!em.is_primary ? (
                    <Button
                      variant="ghost"
                      onClick={() => setDeleteTarget(em)}
                      size="sm"
                      tone="danger"
                      data-testid="remove-email"
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Add email form */}
        <Card>
          <form
            onSubmit={handleAddEmail}
            className="flex flex-col items-end gap-3 sm:flex-row"
            data-testid="add-email-form"
          >
            <div className="w-full flex-1">
              <Input
                id="new-email"
                name="email"
                label="Add Email Address"
                type="email"
                value={newEmail}
                onChange={(v) => setNewEmail(v)}
                placeholder="you@example.com"
                data-testid="new-email-input"
                error={addError ?? undefined}
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              disabled={addEmailMutation.isPending}
              data-testid="add-email-btn"
            >
              {addEmailMutation.isPending ? "Adding..." : "Add Email"}
            </Button>
          </form>
        </Card>
      </section>

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Remove Email"
        message={deleteTarget ? `Remove ${deleteTarget.email} from your account?` : ""}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteEmailMutation.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
