import * as S from "effect/Schema";
import { useForm } from "@tanstack/react-form";
import { createServerFn } from "@tanstack/react-start";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getErrorMessage } from "../lib/errors.js";
import { fieldError } from "../lib/form.js";
import { requiredValidator, usernameValidator, passwordValidator } from "../lib/validators.js";
import { Card } from "../components/ui/Card.js";
import { Input } from "../components/ui/Input.js";
import { acceptInvitation } from "../lib/authForms.js";
import { InviteSearch } from "../../shared/schemas.js";
import { runServerEffect } from "../lib/serverEffect.js";
import { Families } from "../../server/services/families.js";

const getInvitationPageData = createServerFn({ method: "GET" })
  .validator((data: unknown) => S.decodeUnknownSync(InviteSearch)(data))
  .handler(async ({ data }) => {
    const id = data.id;
    if (!id) {
      return { invitation: null, error: null };
    }

    try {
      const invitation = await runServerEffect(
        Families.use((familyService) => familyService.invitation(id, data.code ?? "")),
      );
      return { invitation, error: null };
    } catch (error) {
      return {
        invitation: null,
        error:
          error instanceof Error ? error.message : "This invitation link is invalid or expired.",
      };
    }
  });

export const Route = createFileRoute("/accept-invite")({
  head: () => ({ meta: [{ title: "Accept Invitation | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    ...S.decodeSync(InviteSearch)(search),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  loaderDeps: ({ search }) => ({ id: search.id, code: search.code }),
  loader: ({ deps }) => getInvitationPageData({ data: deps }),
  component: AcceptInvitePage,
  pendingComponent: () => (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <p className="text-sm text-muted">Loading invitation...</p>
      </div>
    </main>
  ),
});

function AcceptInvitePage() {
  const { id, code, error: searchError } = Route.useSearch();
  const { invitation, error: invitationError } = Route.useLoaderData();

  const form = useForm({
    defaultValues: {
      name: "",
      username: "",
      email: "",
      password: "",
    },
  });

  const submitError = form.state.errorMap.onSubmit
    ? getErrorMessage(form.state.errorMap.onSubmit, "Could not accept invitation")
    : null;
  const serverError = searchError ?? submitError;

  if (!id) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">
          <Card className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Invalid Invitation</h1>
            <p className="mt-3 text-sm text-muted">
              This invitation link is incomplete.
            </p>
            <div className="mt-6 flex justify-center">
              <Link to="/" className="text-sm font-medium text-accent hover:underline">
                Back to home
              </Link>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  if (!invitation) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">
          <Card className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Invalid Invitation</h1>
            <p className="mt-3 text-sm text-muted">
              {invitationError ?? "This invitation link is invalid or expired."}
            </p>
            <div className="mt-6 flex justify-center">
              <Link to="/" className="text-sm font-medium text-accent hover:underline">
                Back to home
              </Link>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  const invitedEmail = invitation.email.trim();
  const emailLocked = invitedEmail.length > 0;
  const invitedRole = invitation.invited_role
    ? invitation.invited_role.charAt(0).toUpperCase() + invitation.invited_role.slice(1)
    : null;

  if (emailLocked && !form.getFieldValue("email")) {
    form.setFieldValue("email", invitedEmail);
  }

  return (
    <main data-testid="accept-invite-page" className="flex min-h-screen items-center px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <Card>
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold tracking-tight">Accept Invitation</h1>
            <p className="mt-2 text-sm text-muted">
              Create your DFG Portal account and join{" "}
              <span className="font-semibold text-primary">
                {invitation.name}
              </span>
              .
            </p>
            {invitation.description ? (
              <p className="mt-3 text-sm text-muted">
                {invitation.description}
              </p>
            ) : null}
            {invitedRole ? (
              <p className="mt-2 text-sm text-muted">
                You&apos;re joining as: <span className="font-semibold">{invitedRole}</span>
              </p>
            ) : null}
          </div>

          {serverError ? (
            <div
              data-testid="accept-invite-error"
              role="alert"
              className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
            >
              {serverError}
            </div>
          ) : null}

          <form
            method="post"
            action={acceptInvitation.url}
            onSubmit={async (e) => {
              e.preventDefault();
              const formEl = e.currentTarget;
              const result = await form.validateAllFields("submit");
              if (result) {
                formEl.submit();
              }
            }}
            className="flex flex-col gap-5"
          >
            <input type="hidden" name="id" value={id} />
            {code ? <input type="hidden" name="code" value={code} /> : null}
            {emailLocked ? <input type="hidden" name="email" value={invitedEmail} /> : null}

            <form.Field name="name" validators={requiredValidator}>
              {(field) => (
                <Input
                  id="accept-invite-name"
                  name="name"
                  label="Full Name"
                  required
                  autoComplete="name"
                  data-testid="accept-invite-name"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  error={fieldError(field.state.meta.errors)}
                />
              )}
            </form.Field>

            <form.Field name="username" validators={usernameValidator}>
              {(field) => (
                <Input
                  id="accept-invite-username"
                  name="username"
                  label="Username"
                  required
                  minLength={3}
                  autoComplete="username"
                  data-testid="accept-invite-username"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  error={fieldError(field.state.meta.errors)}
                />
              )}
            </form.Field>

            <form.Field name="email">
              {(field) => (
                <Input
                  id="accept-invite-email"
                  name="email"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  data-testid="accept-invite-email"
                  value={field.state.value}
                  disabled={emailLocked}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  error={fieldError(field.state.meta.errors)}
                />
              )}
            </form.Field>

            {emailLocked ? (
              <p className="text-xs text-muted">
                This invitation was sent to {invitedEmail}.
              </p>
            ) : null}

            <form.Field name="password" validators={passwordValidator}>
              {(field) => (
                <Input
                  id="accept-invite-password"
                  name="password"
                  label="Password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  type="password"
                  data-testid="accept-invite-password"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  error={fieldError(field.state.meta.errors)}
                />
              )}
            </form.Field>

            <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <button
                  type="submit"
                  data-testid="accept-invite-submit"
                  disabled={!canSubmit || isSubmitting}
                  className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-accent-hover data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:transform-none"
                >
                  {isSubmitting ? "Creating Account..." : "Create Account"}
                </button>
              )}
            </form.Subscribe>
          </form>
        </Card>
      </div>
    </main>
  );
}
