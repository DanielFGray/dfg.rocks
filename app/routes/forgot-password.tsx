import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Button } from "../components/ui/Button.js";
import { Input } from "../components/ui/Input.js";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot Password | DFG Portal" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");

  const forgot = useMutation({
    mutationFn: async () => {
      const { error } = await api["forgot-password"].post({ email });
      if (error) throw error;
    },
  });

  // Always show success after submit -- don't reveal if email exists
  const submitted = forgot.isSuccess || forgot.isError;

  if (submitted) {
    return (
      <main data-pwid="forgot-password-page" className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-4 text-3xl font-bold tracking-tight">Check Your Email</h1>
          <p className="text-sm text-muted">
            If an account exists with that email, we've sent a password reset link. Check your inbox.
          </p>
          <Link to="/login" data-pwid="back-to-login" className="mt-6 inline-block text-sm text-accent hover:underline">
            Back to Log In
          </Link>
        </div>
      </main>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    forgot.mutate();
  };

  return (
    <main data-pwid="forgot-password-page" className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Forgot Password</h1>
          <p className="mt-2 text-sm text-muted">Enter your email and we'll send a reset link</p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input
            id="forgot-email"
            name="email"
            label="Email"
            type="email"
            required
            data-pwid="forgot-email"
            value={email}
            onChange={(v) => setEmail(v)}
          />
          <Button
            type="submit"
            variant="primary"
            className="mt-2 w-full"
            data-pwid="forgot-submit"
            disabled={forgot.isPending}
          >
            {forgot.isPending ? "Sending..." : "Send Reset Link"}
          </Button>
        </form>
        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm text-accent hover:underline">
            Back to Log In
          </Link>
        </div>
      </div>
    </main>
  );
}
