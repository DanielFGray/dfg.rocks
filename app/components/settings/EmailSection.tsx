import { useState } from "react";
import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { myEmailsQuery } from "../../lib/queries.js";
import type { UserEmail } from "../../lib/types.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Input } from "../ui/Input.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";

export function EmailSection() {
  const queryClient = useQueryClient();

  const [newEmail, setNewEmail] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UserEmail | null>(null);

  const { data: emails } = useSuspenseQuery(myEmailsQuery);

  const addEmailMutation = useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await api.me.emails.post({ email });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["my-emails"] });
    },
  });

  const makePrimaryMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.me.emails({ id })["make-primary"].post();
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["my-emails"] });
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
      queryClient.invalidateQueries({ queryKey: ["my-emails"] });
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
      <section data-pwid="email-section">
        <h2 className="text-xl font-semibold mb-4">Email Addresses</h2>

        <div className="flex flex-col gap-3 mb-6">
          {(emails as UserEmail[]).map((em) => (
            <Card key={em.id}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-primary break-all">{em.email}</span>
                    {em.is_primary ? (
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-accent/20 text-accent">
                        Primary
                      </span>
                    ) : null}
                    {em.is_verified ? (
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-green-500/20 text-green-400">
                        Verified
                      </span>
                    ) : (
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-500/20 text-amber-400">
                        Unverified
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 shrink-0 flex-wrap">
                  {em.is_verified && !em.is_primary ? (
                    <Button
                      variant="ghost"
                      onClick={() => makePrimaryMutation.mutate(em.id)}
                      className="text-xs px-3 py-1.5"
                      data-pwid="make-primary"
                    >
                      Make Primary
                    </Button>
                  ) : null}
                  {!em.is_verified ? (
                    <Button
                      variant="ghost"
                      onClick={() => resendVerificationMutation.mutate(em.id)}
                      className="text-xs px-3 py-1.5 text-amber-400 hover:text-amber-300"
                      data-pwid="resend-verification"
                    >
                      Resend Verification
                    </Button>
                  ) : null}
                  {!em.is_primary ? (
                    <Button
                      variant="ghost"
                      onClick={() => setDeleteTarget(em)}
                      className="text-xs px-3 py-1.5 text-red-400 hover:text-red-300"
                      data-pwid="remove-email"
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
          <form onSubmit={handleAddEmail} className="flex flex-col sm:flex-row gap-3 items-end" data-pwid="add-email-form">
            <div className="flex-1 w-full">
              <Input
                id="new-email"
                name="email"
                label="Add Email Address"
                type="email"
                value={newEmail}
                onChange={(v) => setNewEmail(v)}
                placeholder="you@example.com"
                data-pwid="new-email-input"
              />
            </div>
            <Button type="submit" variant="outline" data-pwid="add-email-btn">
              Add Email
            </Button>
          </form>
        </Card>
      </section>

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Remove Email"
        message={
          deleteTarget
            ? `Remove ${deleteTarget.email} from your account?`
            : ""
        }
        confirmLabel="Remove"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
