import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import * as v from "valibot";
import { api } from "../lib/api.js";
import { unwrap } from "../lib/queries.js";
import { Button } from "../components/ui/Button.js";
import { Input } from "../components/ui/Input.js";

const requiredValidator = {
  onChange: v.pipe(v.string(), v.minLength(1, "Required")),
};

const passwordValidator = {
  onChange: v.pipe(v.string(), v.minLength(6, "Must be at least 6 characters")),
};

const invitationQuery = (invitationId: string, code: string) =>
  queryOptions({
    queryKey: ["invitation", invitationId, code],
    queryFn: async () =>
      unwrap((await api.invitation({ id: invitationId }).get({
        query: { code: code || undefined },
      })).data),
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

  const accept = useMutation({
    mutationFn: async (value: { name: string; username: string; password: string }) => {
      const { data } = await api.invitation({ id: invitationId }).accept.post({
        code: code || undefined,
        username: value.username,
        password: value.password,
        name: value.name,
      });
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate({ to: "/dashboard" });
    },
  });

  const form = useForm({
    defaultValues: { name: "", username: "", password: "", confirm: "" },
    onSubmit: async ({ value }) => {
      accept.mutate(value);
    },
  });

  const serverError = accept.isError
    ? ((accept.error as any)?.value?.error ?? accept.error.message)
    : null;

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Join {familyName}</h1>
        <p className="mt-2 text-sm text-muted">Create your account to get started</p>
      </div>
      {serverError ? (
        <div data-pwid="accept-invite-error" role="alert" className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {serverError}
        </div>
      ) : null}
      <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="flex flex-col gap-5">
        <form.Field name="name" validators={requiredValidator}>
          {(field) => (
            <Input id="invite-name" name="name" label="Full Name" data-pwid="invite-name" value={field.state.value} onChange={(v) => field.handleChange(v)} onBlur={() => field.handleBlur()} error={field.state.meta.errors[0] as string | undefined} />
          )}
        </form.Field>
        <form.Field name="username" validators={requiredValidator}>
          {(field) => (
            <Input id="invite-username" name="username" label="Username" data-pwid="invite-username" value={field.state.value} onChange={(v) => field.handleChange(v)} onBlur={() => field.handleBlur()} error={field.state.meta.errors[0] as string | undefined} />
          )}
        </form.Field>
        <form.Field name="password" validators={passwordValidator}>
          {(field) => (
            <Input id="invite-password" name="password" label="Password" type="password" data-pwid="invite-password" value={field.state.value} onChange={(v) => field.handleChange(v)} onBlur={() => field.handleBlur()} error={field.state.meta.errors[0] as string | undefined} />
          )}
        </form.Field>
        <form.Field
          name="confirm"
          validators={{
            onChangeListenTo: ["password"],
            onChange: ({ value }) => {
              if (value !== form.getFieldValue("password")) return "Passwords do not match";
              return undefined;
            },
          }}
        >
          {(field) => (
            <Input id="invite-confirm" name="confirm" label="Confirm Password" type="password" data-pwid="invite-confirm" value={field.state.value} onChange={(v) => field.handleChange(v)} onBlur={() => field.handleBlur()} error={field.state.meta.errors[0] as string | undefined} />
          )}
        </form.Field>
        <form.Subscribe selector={(s) => s.canSubmit}>
          {(canSubmit) => (
            <Button type="submit" variant="primary" className="mt-2 w-full" data-pwid="invite-submit" disabled={!canSubmit}>
              Create Account
            </Button>
          )}
        </form.Subscribe>
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
