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

/* ---------------------------------------------------------------------------
 * Password Form
 * --------------------------------------------------------------------------- */
function PasswordForm({
  email,
  onEmailChange,
  redirectTo,
}: {
  email: string;
  onEmailChange: (v: string) => void;
  redirectTo?: string;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.login.post({ id: email, password });
      if (error) throw error;
      return data;
    },
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="gap-5 flex flex-col">
      {login.isPending ? (
        <div
          data-testid="login-pending"
          className="mb-6 rounded-lg border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-400 border"
        >
          Logging in...
        </div>
      ) : login.isError ? (
        <div
          data-testid="login-error"
          role="alert"
          className="mb-6 rounded-lg border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400 border"
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
        onChange={(v) => onEmailChange(v)}
      />
      <Input
        id="login-password"
        name="password"
        label="Password"
        type="password"
        required
        data-testid="login-password"
        value={password}
        onChange={(v) => setPassword(v)}
      />
      <Button type="submit" variant="primary" className="mt-2 w-full" data-testid="login-submit">
        Log In
      </Button>
    </form>
  );
}

/* ---------------------------------------------------------------------------
 * Magic Link Form
 * --------------------------------------------------------------------------- */
function MagicLinkForm({
  email,
  onEmailChange,
  redirectTo,
}: {
  email: string;
  onEmailChange: (v: string) => void;
  redirectTo?: string;
}) {
  const magicLink = useMutation({
    mutationFn: async () => {
      const { error } = await api["magic-link"].post({ email });
      if (error) throw error;
    },
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    rememberLoginRedirect(redirectTo);
    magicLink.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="gap-5 flex flex-col">
      <div className="gap-1.5 flex flex-col">
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
          onChange={(e) => onEmailChange(e.target.value)}
          className="rounded-lg border-overlay/10 dark:border-overlay-dark/10 bg-card dark:bg-card-dark px-4 py-3 text-primary dark:text-primary-dark placeholder:text-muted/50 dark:placeholder:text-muted-dark/50 focus:border-accent focus:ring-accent/50 border transition-colors outline-hidden focus:ring-1"
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

/* ---------------------------------------------------------------------------
 * Login Page
 * --------------------------------------------------------------------------- */
function LoginPage() {
  const { redirect } = Route.useSearch();
  const [activeTab, setActiveTab] = useState<"password" | "magic">("password");
  const [email, setEmail] = useState("");

  useEffect(() => {
    rememberLoginRedirect(redirect);
  }, [redirect]);

  const switchTab = (t: "password" | "magic") => () => {
    setActiveTab(t);
  };

  const tabClass = (t: "password" | "magic") =>
    `flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
      activeTab === t
        ? "bg-overlay/8 dark:bg-overlay-dark/8 text-primary dark:text-primary-dark"
        : "text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark"
    }`;

  return (
    <main data-testid="login-page" className="px-4 flex min-h-screen items-center justify-center">
      <div className="max-w-sm w-full">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Log In</h1>
          <p className="mt-2 text-sm text-muted dark:text-muted-dark">Student Portal</p>
        </div>

        {/* Tab switcher */}
        <div className="mb-6 gap-1 rounded-xl bg-overlay/4 dark:bg-overlay-dark/4 p-1 flex">
          <button type="button" onClick={switchTab("password")} className={tabClass("password")}>
            Password
          </button>
          <button type="button" onClick={switchTab("magic")} className={tabClass("magic")}>
            Magic Link
          </button>
        </div>

        {activeTab === "password" ? (
          <PasswordForm email={email} onEmailChange={setEmail} redirectTo={redirect} />
        ) : (
          <MagicLinkForm email={email} onEmailChange={setEmail} redirectTo={redirect} />
        )}

        {/* Divider */}
        <div className="my-8 relative">
          <div className="inset-0 absolute flex items-center">
            <div className="border-overlay/8 dark:border-overlay-dark/8 w-full border-t" />
          </div>
          <div className="text-xs relative flex justify-center">
            <span className="px-3 text-muted dark:text-muted-dark bg-(--bg)">
              or continue with
            </span>
          </div>
        </div>

        {/* OAuth buttons */}
        <div className="gap-3 flex flex-col">
          <a
            href="/api/oauth/google"
            data-testid="google-oauth"
            className="gap-3 rounded-lg border-overlay/10 dark:border-overlay-dark/10 bg-overlay/4 dark:bg-overlay-dark/4 px-4 py-3 text-sm font-medium text-primary dark:text-primary-dark hover:bg-overlay/8 dark:hover:bg-overlay-dark/8 flex w-full items-center justify-center border transition-colors"
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
          <a
            href="/api/oauth/apple"
            data-testid="apple-oauth"
            className="gap-3 rounded-lg border-overlay/10 dark:border-overlay-dark/10 bg-overlay/4 dark:bg-overlay-dark/4 px-4 py-3 text-sm font-medium text-primary dark:text-primary-dark hover:bg-overlay/8 dark:hover:bg-overlay-dark/8 flex w-full items-center justify-center border transition-colors"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            Sign in with Apple
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
