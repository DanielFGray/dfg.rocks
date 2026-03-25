import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Button } from "../components/ui/Button.js";
import { Input } from "../components/ui/Input.js";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset Password | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) ?? "",
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const reset = useMutation({
    mutationFn: async () => {
      const { error } = await api["reset-password"].post({ token, password });
      if (error) throw error;
    },
    onSuccess: () => {
      navigate({ to: "/login" });
    },
  });

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-4 text-3xl font-bold tracking-tight">Invalid Link</h1>
          <p className="text-sm text-muted">
            This link is missing a token. Please use the link from your reset email.
          </p>
          <Link to="/login" className="mt-6 inline-block text-sm text-accent hover:underline">
            Back to Log In
          </Link>
        </div>
      </main>
    );
  }

  const errorMessage = clientError
    ?? (reset.isError
      ? ((reset.error as any)?.value?.error ?? reset.error.message)
      : null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);

    if (password !== confirm) {
      setClientError("Passwords do not match");
      return;
    }

    reset.mutate();
  };

  return (
    <main data-pwid="reset-password-page" className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Reset Password</h1>
          <p className="mt-2 text-sm text-muted">Enter your new password</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {errorMessage ? (
            <div
              data-pwid="reset-password-error"
              role="alert"
              className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
            >
              {errorMessage}
            </div>
          ) : null}
          <Input
            id="reset-password"
            name="password"
            label="New Password"
            type="password"
            required
            data-pwid="reset-password-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Input
            id="reset-password-confirm"
            name="confirm"
            label="Confirm New Password"
            type="password"
            required
            data-pwid="reset-password-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            className="mt-2 w-full"
            data-pwid="reset-password-submit"
            disabled={reset.isPending}
          >
            {reset.isPending ? "Resetting..." : "Reset Password"}
          </Button>
        </form>
      </div>
    </main>
  );
}
