import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { getAuthUser } from "../lib/auth.js";
import { resetAuthClientState } from "../lib/authClientState.js";
import { getErrorMessage } from "../lib/errors.js";
import { Button } from "../components/ui/Button.js";
import { Card } from "../components/ui/Card.js";
import { TokenSearch, parseWith } from "../../shared/validation.js";

export const Route = createFileRoute("/confirm-delete-account")({
  head: () => ({ meta: [{ title: "Confirm Delete Account | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => parseWith(TokenSearch, search),
  loader: () => getAuthUser(),
  component: ConfirmDeleteAccountPage,
});

function ConfirmDeleteAccountPage() {
  const { token } = Route.useSearch();
  const { user } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();

  const confirmDelete = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Missing deletion token");
      const { error } = await api["confirm-delete-account"].post({ token });
      if (error) throw error;
    },
    onSuccess: async () => {
      await resetAuthClientState({ queryClient, router });
      navigate({ to: "/" });
    },
  });

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">
          <Card className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Invalid Link</h1>
            <p className="mt-3 text-sm text-muted dark:text-muted-dark">
              This delete-account link is missing its confirmation token.
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

  const redirectTo = `/confirm-delete-account?token=${encodeURIComponent(token)}`;
  const loginHref = `/login?redirect=${encodeURIComponent(redirectTo)}`;

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">
          <Card className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Sign In Required</h1>
            <p className="mt-3 text-sm text-muted dark:text-muted-dark">
              Sign in to the account that requested deletion before confirming this action.
            </p>
            <div className="mt-6 flex justify-center">
              <Link
                to="/login"
                search={{ redirect: redirectTo }}
                className="text-sm font-medium text-accent hover:underline"
              >
                Go to Log In
              </Link>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  const serverError = confirmDelete.isError
    ? getErrorMessage(confirmDelete.error, "Could not delete your account")
    : null;

  return (
    <main
      data-testid="confirm-delete-account-page"
      className="flex min-h-screen items-center justify-center px-4"
    >
      <div className="w-full max-w-md">
        <Card>
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Delete Account</h1>
            <p className="mt-3 text-sm text-muted dark:text-muted-dark">
              You&apos;re about to permanently delete the account for{" "}
              <span className="font-semibold text-primary dark:text-primary-dark">
                {user.email || user.username}
              </span>
              .
            </p>
            <p className="mt-2 text-sm text-muted dark:text-muted-dark">
              This action removes your access to the student portal and cannot be undone.
            </p>
          </div>

          {serverError ? (
            <div
              data-testid="confirm-delete-account-error"
              role="alert"
              className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
            >
              {serverError}
            </div>
          ) : null}

          <div className="mt-6 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-4 text-sm text-muted dark:text-muted-dark">
            <p className="font-medium text-red-600 dark:text-red-400">Before you continue</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Your lessons, messages, and account access will be removed.</li>
              <li>You must be signed in to the same account that requested deletion.</li>
              <li>If this link is old, request a fresh delete email from settings.</li>
            </ul>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Link
              to="/settings"
              className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-muted transition-colors hover:bg-overlay/5 hover:text-primary dark:text-muted-dark dark:hover:bg-overlay-dark/5 dark:hover:text-primary-dark"
            >
              Cancel
            </Link>
            <Button
              type="button"
              variant="danger"
              data-testid="confirm-delete-account-submit"
              onClick={() => confirmDelete.mutate()}
              disabled={confirmDelete.isPending}
            >
              {confirmDelete.isPending ? "Deleting Account..." : "Delete Account"}
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
