import { Effect } from "effect";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";

export function DeleteAccountSection({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [successMessage, setSuccessMessage] = useState(false);

  const requestDeleteMutation = useMutation({
    mutationFn: () => Effect.runPromise(api.accounts.requestDeleteAccount()),
    onSuccess: () => {
      setSuccessMessage(true);
      onRefresh();
    },
  });

  return (
    <>
      <section data-testid="delete-account-section" className="mt-12">
        <h2 className="mb-4 text-xl font-semibold text-red-600 dark:text-red-400">
          Delete Account
        </h2>
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-muted">
                Permanently delete your account and all associated data. This action cannot be
                undone.
              </p>
              {successMessage ? (
                <p className="mt-2 text-sm text-green-500">
                  Check your email for the account deletion link.
                </p>
              ) : null}
            </div>
            <Button
              variant="danger"
              onClick={() => setShowConfirm(true)}
              disabled={requestDeleteMutation.isPending}
              data-testid="delete-account-btn"
            >
              {requestDeleteMutation.isPending ? "Sending..." : "Delete Account"}
            </Button>
          </div>
        </Card>
      </section>

      <ConfirmDialog
        open={showConfirm}
        title="Delete Account"
        message="Are you sure you want to delete your account? This action cannot be undone. You will receive an email with a confirmation link."
        confirmLabel="Send Deletion Email"
        variant="danger"
        onConfirm={async () => {
          await requestDeleteMutation.mutateAsync();
          setShowConfirm(false);
        }}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}
