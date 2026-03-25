import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Button } from "../components/ui/Button.js";
import { Input } from "../components/ui/Input.js";

const invitationQuery = (invitationId: string, code: string) =>
  queryOptions({
    queryKey: ["invitation", invitationId, code],
    queryFn: async () => {
      const { data, error } = await api.invitation[invitationId].get({
        query: { code: code || undefined },
      });
      if (error) throw error;
      return data;
    },
  });

export const Route = createFileRoute("/accept-invite")({
  head: () => ({ meta: [{ title: "Accept Invitation | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    id: (search.id as string) ?? "",
    code: (search.code as string) ?? "",
  }),
  loader: ({ context, location }) => {
    const { id, code } = location.search as { id: string; code: string };
    if (!id) return;
    return context.queryClient.ensureQueryData(invitationQuery(id, code));
  },
  component: AcceptInvitePage,
  pendingComponent: () => (
    <main className="flex min-h-screen items-center justify-center px-4">
      <p className="text-muted">Loading invitation...</p>
    </main>
  ),
  errorComponent: () => (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-4 text-3xl font-bold tracking-tight">
          Invitation Not Found
        </h1>
        <p className="text-sm text-muted">
          This invitation may have expired or already been accepted.
        </p>
      </div>
    </main>
  ),
});

/* ---------------------------------------------------------------------------
 * Invitation Form
 * --------------------------------------------------------------------------- */
function InvitationForm({
  invitationId,
  code,
  familyName,
}: {
  invitationId: string;
  code: string;
  familyName: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const accept = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.invitation[invitationId].accept.post({
        code: code || undefined,
        username,
        password,
        name,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate({ to: "/dashboard" });
    },
    onError: (error) => {
      const message = (error as any)?.value?.error ?? (error as Error).message;
      setFormError(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (password !== confirm) {
      setFormError("Passwords do not match");
      return;
    }

    accept.mutate();
  };

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Join {familyName}</h1>
        <p className="mt-2 text-sm text-muted">Create your account to get started</p>
      </div>
      {formError ? (
        <div data-pwid="accept-invite-error" role="alert" className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {formError}
        </div>
      ) : null}
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Input id="invite-name" name="name" label="Full Name" required data-pwid="invite-name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input id="invite-username" name="username" label="Username" required data-pwid="invite-username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Input id="invite-password" name="password" label="Password" type="password" required data-pwid="invite-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Input id="invite-confirm" name="confirm" label="Confirm Password" type="password" required data-pwid="invite-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" variant="primary" className="mt-2 w-full" data-pwid="invite-submit">
          Create Account
        </Button>
      </form>
      <p className="mt-6 text-center text-xs text-muted">
        Already have an account? <Link to="/login" className="text-accent hover:underline">Log in</Link>
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Accept Invite Page
 * --------------------------------------------------------------------------- */
function AcceptInvitePage() {
  const { id: invitationId, code } = Route.useSearch();

  if (!invitationId) {
    return (
      <main data-pwid="accept-invite-page" className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-4 text-3xl font-bold tracking-tight">Invalid Link</h1>
          <p className="text-sm text-muted">
            This link is missing invitation details. Please use the link from your invitation email.
          </p>
        </div>
      </main>
    );
  }

  const { data } = useSuspenseQuery(invitationQuery(invitationId, code));

  return (
    <main data-pwid="accept-invite-page" className="flex min-h-screen items-center justify-center px-4">
      <InvitationForm invitationId={invitationId} code={code} familyName={data.name} />
    </main>
  );
}
