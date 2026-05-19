import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import * as v from "valibot";
import { api } from "../lib/api.js";
import { resetAuthClientState } from "../lib/authClientState.js";
import { getErrorMessage } from "../lib/errors.js";
import { fieldError } from "../lib/form.js";
import { getInvitationData } from "../lib/routeData.js";
import { Button } from "../components/ui/Button.js";
import { Card } from "../components/ui/Card.js";
import { Input } from "../components/ui/Input.js";
import { Select } from "../components/ui/Select.js";
import { InviteSearch, parseWith } from "../../shared/validation.js";

type InvitationPageData = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
  email: string;
};

type InvitationLoaderData = {
  invitation: InvitationPageData | null;
  error: string | null;
};

const roleOptions = [
  { value: "student", label: "Student" },
  { value: "parent", label: "Parent" },
];

const requiredText = {
  onChange: v.pipe(v.string(), v.minLength(1, "Required")),
};

const usernameValidator = {
  onChange: v.pipe(v.string(), v.minLength(3, "Must be at least 3 characters")),
};

const emailValidator = {
  onChange: v.pipe(v.string(), v.minLength(1, "Required"), v.email("Invalid email")),
};

const passwordValidator = {
  onChange: v.pipe(v.string(), v.minLength(6, "Must be at least 6 characters")),
};

export const Route = createFileRoute("/accept-invite")({
  head: () => ({ meta: [{ title: "Accept Invitation | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => parseWith(InviteSearch, search),
  loaderDeps: ({ search }) => ({ id: search.id, code: search.code ?? "" }),
  loader: async ({ deps }): Promise<InvitationLoaderData> => {
    if (!deps.id) {
      return {
        invitation: null,
        error: "This invitation link is missing an invitation id.",
      };
    }

    try {
      return {
        invitation: await getInvitationData({ data: { id: deps.id, code: deps.code } }),
        error: null,
      };
    } catch (error) {
      return {
        invitation: null,
        error:
          error instanceof Error ? error.message : "This invitation link is invalid or expired.",
      };
    }
  },
  component: AcceptInvitePage,
  pendingComponent: () => (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <p className="text-sm text-muted dark:text-muted-dark">Loading invitation...</p>
      </div>
    </main>
  ),
});

function AcceptInvitePage() {
  const { id, code } = Route.useSearch();
  const { invitation, error } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();

  const acceptInvitation = useMutation({
    mutationFn: async (value: {
      name: string;
      username: string;
      email: string;
      password: string;
      role: string;
    }) => {
      if (!id) {
        throw new Error("Missing invitation id");
      }

      const { error } = await api.invitation({ id }).accept.post({
        code: code || undefined,
        username: value.username,
        password: value.password,
        name: value.name,
        email: value.email,
        role: value.role,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await resetAuthClientState({ queryClient, router });
      navigate({ to: "/dashboard" });
    },
  });

  const form = useForm({
    defaultValues: {
      name: "",
      username: "",
      email: invitation?.email ?? "",
      password: "",
      role: "student",
    },
    onSubmit: async ({ value }) => {
      acceptInvitation.mutate(value);
    },
  });

  if (!id || error || !invitation) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">
          <Card className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Invalid Invitation</h1>
            <p className="mt-3 text-sm text-muted dark:text-muted-dark">
              {error ?? "This invitation link is incomplete."}
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

  const serverError = acceptInvitation.isError
    ? getErrorMessage(acceptInvitation.error, "Could not accept invitation")
    : null;
  const invitedEmail = invitation.email.trim();
  const emailLocked = invitedEmail.length > 0;

  return (
    <main data-testid="accept-invite-page" className="flex min-h-screen items-center px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <Card>
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold tracking-tight">Accept Invitation</h1>
            <p className="mt-2 text-sm text-muted dark:text-muted-dark">
              Create your DFG Portal account and join{" "}
              <span className="font-semibold text-primary dark:text-primary-dark">
                {invitation.name}
              </span>
              .
            </p>
            {invitation.description ? (
              <p className="mt-3 text-sm text-muted dark:text-muted-dark">
                {invitation.description}
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
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
            className="flex flex-col gap-5"
          >
            <form.Field name="name" validators={requiredText}>
              {(field) => (
                <Input
                  id="accept-invite-name"
                  name="name"
                  label="Full Name"
                  data-testid="accept-invite-name"
                  value={field.state.value}
                  onChange={(value) => field.handleChange(value)}
                  onBlur={() => field.handleBlur()}
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
                  data-testid="accept-invite-username"
                  value={field.state.value}
                  onChange={(value) => field.handleChange(value)}
                  onBlur={() => field.handleBlur()}
                  error={fieldError(field.state.meta.errors)}
                />
              )}
            </form.Field>

            <form.Field name="email" validators={emailValidator}>
              {(field) => (
                <Input
                  id="accept-invite-email"
                  name="email"
                  label="Email"
                  type="email"
                  data-testid="accept-invite-email"
                  value={field.state.value}
                  disabled={emailLocked}
                  onChange={(value) => field.handleChange(value)}
                  onBlur={() => field.handleBlur()}
                  error={fieldError(field.state.meta.errors)}
                />
              )}
            </form.Field>

            {emailLocked ? (
              <p className="text-xs text-muted dark:text-muted-dark">
                This invitation was sent to {invitedEmail}.
              </p>
            ) : null}

            <form.Field name="role">
              {(field) => (
                <Select
                  id="accept-invite-role"
                  name="role"
                  label="I&apos;m joining as"
                  data-testid="accept-invite-role"
                  options={roleOptions}
                  value={field.state.value}
                  onChange={(value) => field.handleChange(value)}
                />
              )}
            </form.Field>

            <form.Field name="password" validators={passwordValidator}>
              {(field) => (
                <Input
                  id="accept-invite-password"
                  name="password"
                  label="Password"
                  type="password"
                  data-testid="accept-invite-password"
                  value={field.state.value}
                  onChange={(value) => field.handleChange(value)}
                  onBlur={() => field.handleBlur()}
                  error={fieldError(field.state.meta.errors)}
                />
              )}
            </form.Field>

            <Button
              type="submit"
              className="mt-2 w-full"
              data-testid="accept-invite-submit"
              disabled={acceptInvitation.isPending}
            >
              {acceptInvitation.isPending ? "Creating Account..." : "Create Account"}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
