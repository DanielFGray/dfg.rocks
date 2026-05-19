import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { UserEmail } from "../../lib/types.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Input } from "../ui/Input.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";

export function EmailSection({
  emails,
  onRefresh,
}: {
  emails: UserEmail[];
  onRefresh: () => void;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UserEmail | null>(null);

  const addEmailMutation = useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await api.me.emails.post({ email });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      onRefresh();
    },
  });

  const makePrimaryMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.me.emails({ id })["make-primary"].post();
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      onRefresh();
    },
  });

  const resendVerificationMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.me.emails({ id })["resend-verification"].post();
      if (error) throw error;
      return data;
    },
  });

  const deleteEmailMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.me.emails({ id }).delete();
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      onRefresh();
    },
  });

  const handleAddEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    addEmailMutation.mutate(newEmail);
    setNewEmail("");
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteEmailMutation.mutate(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <>
      <section data-testid="email-section">
        <h2 className="text-xl font-semibold mb-4">Email Addresses</h2>

        <div className="gap-3 mb-6 flex flex-col">
          {emails.map((em) => (
            <Card key={em.id}>
              <div className="sm:flex-row sm:items-center sm:justify-between gap-3 flex flex-col">
                <div className="min-w-0">
                  <div className="gap-2 flex flex-wrap items-center">
                    <span className="font-medium text-primary dark:text-primary-dark break-all">
                      {em.email}
                    </span>
                    {em.is_primary ? (
                      <span className="px-2 py-0.5 text-xs font-semibold bg-accent/20 text-accent rounded-full">
                        Primary
                      </span>
                    ) : null}
                    {em.is_verified ? (
                      <span className="px-2 py-0.5 text-xs font-semibold bg-green-500/20 text-green-400 rounded-full">
                        Verified
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs font-semibold bg-amber-500/20 text-amber-400 rounded-full">
                        Unverified
                      </span>
                    )}
                  </div>
                </div>

                <div className="gap-2 flex shrink-0 flex-wrap">
                  {em.is_verified && !em.is_primary ? (
                    <Button
                      variant="ghost"
                      onClick={() => makePrimaryMutation.mutate(em.id)}
                      className="text-xs px-3 py-1.5"
                      data-testid="make-primary"
                    >
                      Make Primary
                    </Button>
                  ) : null}
                  {!em.is_verified ? (
                    <Button
                      variant="ghost"
                      onClick={() => resendVerificationMutation.mutate(em.id)}
                      className="text-xs px-3 py-1.5 text-amber-400 hover:text-amber-300"
                      data-testid="resend-verification"
                    >
                      Resend Verification
                    </Button>
                  ) : null}
                  {!em.is_primary ? (
                    <Button
                      variant="ghost"
                      onClick={() => setDeleteTarget(em)}
                      className="text-xs px-3 py-1.5 text-red-600 hover:text-red-500 dark:text-red-400 dark:hover:text-red-300"
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
            className="sm:flex-row gap-3 flex flex-col items-end"
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
              />
            </div>
            <Button type="submit" variant="outline" data-testid="add-email-btn">
              Add Email
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
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
