import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Button } from "../components/ui/Button.js";

export const Route = createFileRoute("/confirm-delete-account")({
  head: () => ({ meta: [{ title: "Delete Account | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) ?? "",
  }),
  component: ConfirmDeleteAccountPage,
});

function ConfirmDeleteAccountPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await api["confirm-delete-account"].post({ token });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate({ to: "/" });
    },
  });

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-4 text-3xl font-bold tracking-tight">Invalid Link</h1>
          <p className="text-sm text-muted">
            This link is missing a token. Please use the link from your email.
          </p>
          <Link to="/dashboard" className="mt-6 inline-block text-sm text-accent hover:underline">
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (deleteMutation.isSuccess) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-4 text-3xl font-bold tracking-tight">Account Deleted</h1>
          <p className="text-sm text-muted">Your account has been permanently deleted.</p>
          <Link to="/" className="mt-6 inline-block text-sm text-accent hover:underline">
            Go to Home
          </Link>
        </div>
      </main>
    );
  }

  const errorMessage = deleteMutation.isError
    ? ((deleteMutation.error as any)?.value?.error ?? deleteMutation.error.message)
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    deleteMutation.mutate();
  };

  return (
    <main data-pwid="confirm-delete-page" className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-red-400">Delete Account</h1>
          <p className="mt-2 text-sm text-muted">
            This action is permanent and cannot be undone.
          </p>
        </div>
        {errorMessage ? (
          <div role="alert" className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {errorMessage}
          </div>
        ) : null}
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Button
            type="submit"
            variant="primary"
            className="mt-2 w-full bg-red-600 hover:bg-red-700"
            data-pwid="confirm-delete-submit"
          >
            Permanently Delete My Account
          </Button>
        </form>
        <div className="mt-6 text-center">
          <Link to="/dashboard" className="text-sm text-accent hover:underline">
            Cancel
          </Link>
        </div>
      </div>
    </main>
  );
}
