import { Effect } from "effect";
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { getErrorMessage } from "../lib/errors.js";
import { resetAuthClientState } from "../lib/authClientState.js";
import {
  consumeLoginRedirect,
  normalizeLoginRedirect,
  rememberLoginRedirect,
} from "../lib/loginRedirect.js";
import { Button } from "../components/ui/Button.js";
import { Input } from "../components/ui/Input.js";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Log In | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: normalizeLoginRedirect(search.redirect),
  }),
  component: LoginPage,
});

function PasswordForm({
  email,
  onEmailChange,
  redirectTo,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  redirectTo?: string;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () =>
      Effect.runPromise(api.auth.login({ payload: { id: email, password } })),
    onSuccess: async () => {
      await resetAuthClientState({ queryClient, router });
      const nextRedirect = consumeLoginRedirect(redirectTo);
      if (nextRedirect) {
        window.location.assign(nextRedirect);
        return;
      }
      navigate({ to: "/dashboard" });
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        login.mutate();
      }}
      className="flex flex-col gap-5"
    >
      {login.isPending ? (
        <div
          data-testid="login-pending"
          className="mb-6 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-400"
        >
          Logging in...
        </div>
      ) : login.isError ? (
        <div
          data-testid="login-error"
          role="alert"
          className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
        >
          {getErrorMessage(login.error, "Login failed")}
        </div>
      ) : null}
      <Input
        id="login-id"
        name="id"
        label="Username or Email"
        required
        data-testid="login-id"
        value={email}
        onChange={onEmailChange}
      />
      <Input
        id="login-password"
        name="password"
        label="Password"
        type="password"
        required
        data-testid="login-password"
        value={password}
        onChange={setPassword}
      />
      <Button type="submit" variant="primary" className="mt-2 w-full" data-testid="login-submit">
        Log In
      </Button>
    </form>
  );
}

function MagicLinkForm({
  email,
  onEmailChange,
  redirectTo,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  redirectTo?: string;
}) {
  const magicLink = useMutation({
    mutationFn: () =>
      Effect.runPromise(api.auth.magicLink({ payload: { email } })),
  });

  if (magicLink.isSuccess) {
    return (
      <div className="py-8 text-center">
        <p className="mb-2 text-lg font-semibold text-primary dark:text-primary-dark">
          Check your email
        </p>
        <p className="text-sm text-muted dark:text-muted-dark">
          We sent a magic link to your email address. Click the link to log in.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!email.trim()) return;
        rememberLoginRedirect(redirectTo);
        magicLink.mutate();
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="magic-email"
          className="text-sm font-medium text-muted dark:text-muted-dark"
        >
          Email
        </label>
        <input
          id="magic-email"
          name="email"
          type="email"
          required
          data-testid="magic-email"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          className="rounded-lg border border-overlay/10 bg-card px-4 py-3 text-primary outline-hidden transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-1 focus:ring-accent/50 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark dark:placeholder:text-muted-dark/50"
        />
      </div>
      <Button
        type="submit"
        variant="primary"
        className="mt-2 w-full"
        data-testid="magic-link-submit"
      >
        Send Magic Link
      </Button>
    </form>
  );
}

function LoginPage() {
  const { redirect } = Route.useSearch();
  const [activeTab, setActiveTab] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");
  const googleOauthHref = redirect
    ? `/api/oauth/google?redirect=${encodeURIComponent(redirect)}`
    : "/api/oauth/google";

  useEffect(() => {
    rememberLoginRedirect(redirect);
  }, [redirect]);

  const tabClass = (tab: "password" | "magic") =>
    `flex-1 cursor-pointer rounded-lg py-2.5 text-sm font-medium transition-colors ${
      activeTab === tab
        ? "bg-overlay/8 text-primary dark:bg-overlay-dark/8 dark:text-primary-dark"
        : "text-muted hover:text-primary dark:text-muted-dark dark:hover:text-primary-dark"
    }`;

  return (
    <main data-testid="login-page" className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Log In</h1>
          <p className="mt-2 text-sm text-muted dark:text-muted-dark">Student Portal</p>
        </div>

        <div className="mb-6 flex gap-1 rounded-xl bg-overlay/4 p-1 dark:bg-overlay-dark/4">
          <button
            type="button"
            onClick={() => setActiveTab("password")}
            className={tabClass("password")}
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("magic")}
            className={tabClass("magic")}
          >
            Magic Link
          </button>
        </div>

        {activeTab === "password" ? (
          <PasswordForm email={email} onEmailChange={setEmail} redirectTo={redirect} />
        ) : (
          <MagicLinkForm email={email} onEmailChange={setEmail} redirectTo={redirect} />
        )}

        <div className="relative my-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-overlay/8 dark:border-overlay-dark/8" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-(--bg) px-3 text-muted dark:text-muted-dark">
              or continue with
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <a
            href={googleOauthHref}
            data-testid="google-oauth"
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-overlay/10 bg-overlay/4 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-overlay/8 dark:border-overlay-dark/10 dark:bg-overlay-dark/4 dark:text-primary-dark dark:hover:bg-overlay-dark/8"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Sign in with Google
          </a>
        </div>

        <div className="mt-6 text-center">
          <Link
            to="/forgot-password"
            data-testid="forgot-password-link"
            className="text-sm text-accent hover:underline"
          >
            Forgot password?
          </Link>
        </div>
      </div>
    </main>
  );
}
