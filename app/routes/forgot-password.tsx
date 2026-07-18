import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "../components/ui/Button.js";
import { Input } from "../components/ui/Input.js";
import { forgotPassword } from "../lib/authForms.js";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot Password | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    ...(search.sent === "true" ? { sent: true as const } : {}),
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { sent } = Route.useSearch();
  const [email, setEmail] = useState("");

  if (sent) {
    return (
      <main
        data-testid="forgot-password-page"
        className="flex min-h-screen items-center justify-center px-4"
      >
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-4 text-3xl font-bold tracking-tight">Check Your Email</h1>
          <p className="text-sm text-muted dark:text-muted-dark">
            If an account exists with that email, we've sent a password reset link. Check your
            inbox.
          </p>
          <Link
            to="/login"
            search={{ redirect: undefined }}
            data-testid="back-to-login"
            className="mt-6 inline-block text-sm text-accent hover:underline"
          >
            Back to Log In
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main
      data-testid="forgot-password-page"
      className="flex min-h-screen items-center justify-center px-4"
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Forgot Password</h1>
          <p className="mt-2 text-sm text-muted dark:text-muted-dark">
            Enter your email and we'll send a reset link
          </p>
        </div>
        <form
          method="post"
          action={forgotPassword.url}
          className="flex flex-col gap-5"
        >
          <Input
            id="forgot-email"
            name="email"
            label="Email"
            type="email"
            required
            autoComplete="email"
            data-testid="forgot-email"
            value={email}
            onChange={(v) => setEmail(v)}
          />
          <Button
            type="submit"
            variant="primary"
            className="mt-2 w-full"
            data-testid="forgot-submit"
          >
            Send Reset Link
          </Button>
        </form>
        <div className="mt-6 text-center">
          <Link
            to="/login"
            search={{ redirect: undefined }}
            className="text-sm text-accent hover:underline"
          >
            Back to Log In
          </Link>
        </div>
      </div>
    </main>
  );
}
