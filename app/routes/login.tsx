import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { Key } from "@react-types/shared";
import { Input } from "../components/ui/Input.js";
import { Tabs, TabList, Tab, TabPanel } from "../components/ui/Tabs.js";
import { normalizeLoginRedirect, rememberLoginRedirect } from "../lib/loginRedirect.js";
import { loginWithPassword, requestMagicLink } from "../lib/authForms.js";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Log In | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    ...(normalizeLoginRedirect(search.redirect)
      ? { redirect: normalizeLoginRedirect(search.redirect) }
      : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
    ...(search.magic_sent === "true" ? { magic_sent: true as const } : {}),
    ...(search.login_method === "magic" ? { login_method: "magic" as const } : {}),
  }),
  component: LoginPage,
});

function PasswordForm({
  email,
  onEmailChange,
  redirectTo,
  serverError,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  redirectTo?: string;
  serverError: string | undefined;
}) {
  const [password, setPassword] = useState("");

  return (
    <form method="post" action={loginWithPassword.url} className="flex flex-col gap-5">
      {serverError ? (
        <div
          data-testid="login-error"
          role="alert"
          className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
        >
          {serverError}
        </div>
      ) : null}
      {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}
      <Input
        id="login-id"
        name="id"
        label="Username or Email"
        required
        autoComplete="username"
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
        autoComplete="current-password"
        data-testid="login-password"
        value={password}
        onChange={setPassword}
      />
      <button
        type="submit"
        data-testid="login-submit"
        className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-accent-hover"
      >
        Log In
      </button>
    </form>
  );
}

function MagicLinkForm({
  email,
  onEmailChange,
  redirectTo,
  magicSent,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  redirectTo?: string;
  magicSent: boolean | undefined;
}) {
  if (magicSent) {
    return (
      <div className="py-8 text-center">
        <p className="mb-2 text-lg font-semibold text-primary">
          Check your email
        </p>
        <p className="text-sm text-muted">
          We sent a magic link to your email address. Click the link to log in.
        </p>
      </div>
    );
  }

  return (
    <form
      method="post"
      action={requestMagicLink.url}
      onSubmit={() => {
        rememberLoginRedirect(redirectTo);
      }}
      className="flex flex-col gap-5"
    >
      {redirectTo ? <input type="hidden" name="redirect" value={redirectTo} /> : null}
      <Input
        id="magic-email"
        name="email"
        type="email"
        label="Email"
        required
        autoComplete="email"
        data-testid="magic-email"
        value={email}
        onChange={onEmailChange}
      />
      <button
        type="submit"
        data-testid="magic-link-submit"
        className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-accent-hover data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:transform-none"
      >
        Send Magic Link
      </button>
    </form>
  );
}

function LoginPage() {
  const { redirect, error, magic_sent, login_method } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [selectedTab, setSelectedTab] = useState<Key>(
    login_method === "magic" ? "magic" : "password",
  );

  useEffect(() => {
    setSelectedTab(login_method === "magic" ? "magic" : "password");
  }, [login_method]);

  const googleOauthHref = redirect
    ? `/api/oauth/google?redirect=${encodeURIComponent(redirect)}`
    : "/api/oauth/google";

  return (
    <main data-testid="login-page" className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Log In</h1>
          <p className="mt-2 text-sm text-muted">Student Portal</p>
        </div>

        <Tabs selectedKey={selectedTab} onSelectionChange={setSelectedTab} className="mb-6">
          <TabList>
            <Tab id="password">Password</Tab>
            <Tab id="magic">Magic Link</Tab>
          </TabList>
          <TabPanel id="password" className="mt-6">
            <PasswordForm
              email={email}
              onEmailChange={setEmail}
              redirectTo={redirect}
              serverError={error}
            />
          </TabPanel>
          <TabPanel id="magic" className="mt-6">
            <MagicLinkForm
              email={email}
              onEmailChange={setEmail}
              redirectTo={redirect}
              magicSent={magic_sent}
            />
          </TabPanel>
        </Tabs>

        <div className="relative my-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-overlay/8" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-(--bg) px-3 text-muted">or continue with</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <a
            href={googleOauthHref}
            data-testid="google-oauth"
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-overlay/10 bg-overlay/4 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-overlay/8"
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
          <Link to="/forgot-password" className="text-sm text-accent hover:underline">
            Forgot password?
          </Link>
        </div>
      </div>
    </main>
  );
}
