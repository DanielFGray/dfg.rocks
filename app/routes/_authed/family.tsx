import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { useState } from "react";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { api } from "../../lib/api.js";
import { Card } from "../../components/ui/Card.js";
import { Button } from "../../components/ui/Button.js";
import { Input } from "../../components/ui/Input.js";

export const Route = createFileRoute("/_authed/family")({
  head: () => ({ meta: [{ title: "Family | DFG Portal" }] }),
  component: FamilyPage,
  pendingComponent: () => (
    <main className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 text-muted md:px-8">Loading...</main>
  ),
});

function FamilyPage() {
  const { user, isParent } = useAuth();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [childEmail, setChildEmail] = useState<string>("");
  const [editingEmailFor, setEditingEmailFor] = useState<string | null>(null);
  const [passwordToken, setPasswordToken] = useState<string | null>(null);
  const [passwordTokenFor, setPasswordTokenFor] = useState<string | null>(null);
  const [childPassword, setChildPassword] = useState<string>("");
  const [childEmailError, setChildEmailError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["family"],
    queryFn: () => Effect.runPromise(api.families.family()),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      Effect.runPromise(api.families.removeFamilyMember({ payload: { user_id: userId } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["family"] });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: (email: string) =>
      Effect.runPromise(api.families.inviteFamilyMember({ payload: { email } })),
    onSuccess: () => {
      setInviteEmail("");
      setInviteError(null);
      queryClient.invalidateQueries({ queryKey: ["family"] });
    },
    onError: (err: unknown) => {
      setInviteError(err instanceof Error ? err.message : "Failed to send invite");
    },
  });

  const setChildEmailMutation = useMutation({
    mutationFn: ({ childId, email }: { childId: string; email: string }) =>
      Effect.runPromise(api.families.setChildEmail({ params: { childId }, payload: { email } })),
    onSuccess: () => {
      setChildEmail("");
      setEditingEmailFor(null);
      setChildEmailError(null);
      queryClient.invalidateQueries({ queryKey: ["family"] });
    },
    onError: (err: unknown) => {
      setChildEmailError(err instanceof Error ? err.message : "Failed to set email");
    },
  });

  const requestPasswordTokenMutation = useMutation({
    mutationFn: (childId: string) =>
      Effect.runPromise(api.families.requestChildPasswordSet({ params: { childId } })),
    onSuccess: (data) => {
      setPasswordToken(data.token);
      setPasswordTokenFor(null);
    },
  });

  const setChildPasswordMutation = useMutation({
    mutationFn: ({
      childId,
      token,
      password,
    }: {
      childId: string;
      token: string;
      password: string;
    }) =>
      Effect.runPromise(
        api.families.setChildPassword({
          params: { childId },
          payload: { token, password },
        }),
      ),
    onSuccess: () => {
      setPasswordToken(null);
      setPasswordTokenFor(null);
      setChildPassword("");
      queryClient.invalidateQueries({ queryKey: ["family"] });
    },
  });

  if (!isParent) {
    return (
      <main data-testid="family-page" className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 md:px-8">
        <h1 className="mb-3 text-3xl font-bold tracking-tight">Family</h1>
        <p className="text-muted">Only parents can manage family settings.</p>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main
        data-testid="family-page"
        className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 text-muted md:px-8"
      >
        Loading...
      </main>
    );
  }

  const isOwner =
    user?.role === "admin" || data?.members.some((m) => m.id === user?.id && m.is_owner);

  return (
    <main data-testid="family-page" className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 md:px-8">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">Family</h1>
      <p className="mb-8 text-muted">Manage your family members and invite co-parents.</p>

      {data ? (
        <Card className="mb-8">
          <h2 data-testid="family-name" className="mb-1 text-xl font-semibold tracking-tight">
            {data.name}
          </h2>
          <p className="text-sm text-muted">{data.slug}</p>
          {data.description ? <p className="mt-2 text-sm text-muted">{data.description}</p> : null}
        </Card>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-4 text-xl font-semibold tracking-tight">Members</h2>
        {data?.members.length === 0 ? (
          <p className="text-muted">No members found.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data?.members.map((member) => (
              <Card key={member.id} data-testid={`family-member-${member.id}`}>
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{member.name}</p>
                    <p className="truncate text-sm text-muted">@{member.username}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {member.is_owner ? (
                      <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
                        Owner
                      </span>
                    ) : member.role === "parent" ? (
                      <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                        Parent
                      </span>
                    ) : (
                      <span className="rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                        Student
                      </span>
                    )}
                    {member.is_billing_contact ? (
                      <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                        Billing
                      </span>
                    ) : null}
                  </div>
                </div>
                {member.role === "student" && isOwner ? (
                  <div className="mt-4 border-t border-overlay/5 pt-4">
                    <p className="mb-2 text-sm font-medium text-muted">Credentials</p>

                    {editingEmailFor === member.id ? (
                      <div className="space-y-2">
                        <Input
                          id={`child-email-${member.id}`}
                          name={`child-email-${member.id}`}
                          label="Email"
                          type="email"
                          placeholder={`${member.username}@example.com`}
                          value={childEmail}
                          onChange={setChildEmail}
                          error={childEmailError ?? undefined}
                          disabled={setChildEmailMutation.isPending}
                          data-testid={`child-email-input-${member.id}`}
                        />
                        <div className="flex gap-2">
                          <Button
                            className="flex-1"
                            disabled={!childEmail.trim() || setChildEmailMutation.isPending}
                            onClick={() =>
                              setChildEmailMutation.mutate({
                                childId: member.id,
                                email: childEmail.trim(),
                              })
                            }
                            data-testid={`save-child-email-${member.id}`}
                          >
                            {setChildEmailMutation.isPending ? "Saving..." : "Save"}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setEditingEmailFor(null);
                              setChildEmail("");
                              setChildEmailError(null);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setEditingEmailFor(member.id)}
                        data-testid={`set-email-${member.id}`}
                      >
                        Set Email
                      </Button>
                    )}

                    {passwordTokenFor === member.id && passwordToken ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-muted">
                          Token:{" "}
                          <code className="rounded bg-overlay/5 px-1 py-0.5 text-xs">
                            {passwordToken}
                          </code>
                        </p>
                        <Input
                          id={`child-password-${member.id}`}
                          name={`child-password-${member.id}`}
                          label="New Password"
                          type="password"
                          placeholder="Enter password"
                          value={childPassword}
                          onChange={setChildPassword}
                          disabled={setChildPasswordMutation.isPending}
                          data-testid={`child-password-input-${member.id}`}
                        />
                        <div className="flex gap-2">
                          <Button
                            className="flex-1"
                            disabled={!childPassword.trim() || setChildPasswordMutation.isPending}
                            onClick={() =>
                              setChildPasswordMutation.mutate({
                                childId: member.id,
                                token: passwordToken,
                                password: childPassword,
                              })
                            }
                            data-testid={`save-child-password-${member.id}`}
                          >
                            {setChildPasswordMutation.isPending ? "Saving..." : "Set Password"}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setPasswordToken(null);
                              setPasswordTokenFor(null);
                              setChildPassword("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        className="mt-3 w-full"
                        onClick={() => {
                          setPasswordTokenFor(member.id);
                          requestPasswordTokenMutation.mutate(member.id);
                        }}
                        disabled={
                          passwordTokenFor === member.id && requestPasswordTokenMutation.isPending
                        }
                        data-testid={`request-password-token-${member.id}`}
                      >
                        {passwordTokenFor === member.id && requestPasswordTokenMutation.isPending
                          ? "Generating Token..."
                          : "Set Password"}
                      </Button>
                    )}
                  </div>
                ) : null}
                {member.id !== user?.id && isOwner ? (
                  <Button
                    variant="danger"
                    className="mt-4 w-full"
                    data-testid={`remove-member-${member.id}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${member.name} from the family?`)) {
                        removeMutation.mutate(member.id);
                      }
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </section>

      {isOwner ? (
        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold tracking-tight">Invite Co-Parent</h2>
          <Card>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Input
                  id="invite-email"
                  name="invite-email"
                  label="Email address"
                  type="email"
                  placeholder="co-parent@example.com"
                  value={inviteEmail}
                  onChange={setInviteEmail}
                  data-testid="invite-email-input"
                  error={inviteError ?? undefined}
                />
              </div>
              <Button
                data-testid="invite-submit"
                disabled={!inviteEmail.trim() || inviteMutation.isPending}
                onClick={() => inviteMutation.mutate(inviteEmail.trim())}
              >
                {inviteMutation.isPending ? "Sending..." : "Send Invite"}
              </Button>
            </div>
          </Card>
        </section>
      ) : null}

      <section>
        <h2 className="mb-4 text-xl font-semibold tracking-tight">Pending Invitations</h2>
        {!data?.pendingInvitations || data.pendingInvitations.length === 0 ? (
          <p className="text-muted">No pending invitations.</p>
        ) : (
          <div className="grid gap-3">
            {data.pendingInvitations.map((inv) => (
              <Card key={inv.id} data-testid={`family-invitation-${inv.id}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{inv.email ?? "Unknown"}</p>
                    <p className="text-sm text-muted">
                      Role: {inv.invited_role} &middot;
                      {inv.expires_at ? (
                        <> Expires: {inv.expires_at.toLocaleDateString()}</>
                      ) : (
                        " No expiry"
                      )}
                    </p>
                  </div>
                  <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs font-medium text-yellow-600 dark:text-yellow-400">
                    Pending
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
