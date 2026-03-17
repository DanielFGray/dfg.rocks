import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "fibrae";
import { NavigatorTag } from "fibrae/router";
import type { VElement } from "fibrae";
import { Link } from "fibrae/router";
import { DfgApi } from "./api.js";
import { currentUser, emailValue } from "./auth.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";

const loginError = Atom.make<string | null>(null);
const magicLinkSent = Atom.make(false);
const activeTab = Atom.make<"password" | "magic">("password");

export function LoginPage() {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const error = registry.get(loginError);
    const sent = registry.get(magicLinkSent);
    const tab = registry.get(activeTab);
    const email = registry.get(emailValue);

    const handlePasswordSubmit = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const data = new FormData(form);
      const id = data.get("id") as string;
      const password = data.get("password") as string;

      registry.set(loginError, null);

      return Effect.gen(function* () {
        const api = yield* DfgApi;
        const result = yield* Effect.either(api.auth.login({ payload: { id, password } }));

        if (result._tag === "Left") {
          const err = result.left;
          const message = typeof err === "object" && err !== null && "error" in err
            ? (err as { error: string }).error
            : String(err);
          registry.set(loginError, message);
          return;
        }

        registry.set(currentUser, result.right);
        const navigator = yield* NavigatorTag;
        yield* navigator.go("/dashboard");
      });
    };

    const handleMagicLinkSubmit = (e: Event) => {
      e.preventDefault();
      registry.set(loginError, null);

      return Effect.gen(function* () {
        const api = yield* DfgApi;
        const reg = yield* AtomRegistry.AtomRegistry;
        const email = reg.get(emailValue);
        if (!email.trim()) return;

        const result = yield* Effect.either(api.auth.requestMagicLink({ payload: { email } }));
        if (result._tag === "Left") {
          const err = result.left;
          const message = typeof err === "object" && err !== null && "error" in err
            ? (err as { error: string }).error
            : String(err);
          registry.set(loginError, message);
          return;
        }

        registry.set(magicLinkSent, true);
      });
    };

    const onEmailInput = (e: Event) => {
      const target = e.target as HTMLInputElement;
      registry.set(emailValue, target.value);
    };

    const switchTab = (t: "password" | "magic") => () => {
      registry.set(activeTab, t);
      registry.set(loginError, null);
      registry.set(magicLinkSent, false);
    };

    const tabClass = (t: "password" | "magic") =>
      `flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors ${
        tab === t
          ? "bg-white/[0.08] text-primary"
          : "text-muted hover:text-primary"
      }`;

    return (
      <main data-cy="login-page" class="min-h-screen flex items-center justify-center px-4">
        <div class="w-full max-w-sm">
          <div class="text-center mb-8">
            <h1 class="text-3xl font-bold tracking-tight">Log In</h1>
            <p class="text-muted mt-2 text-sm">Student Portal</p>
          </div>

          {/* Tab switcher */}
          <div class="flex gap-1 mb-6 p-1 rounded-xl bg-white/[0.04]">
            <button type="button" onclick={switchTab("password")} class={tabClass("password")}>
              Password
            </button>
            <button type="button" onclick={switchTab("magic")} class={tabClass("magic")}>
              Magic Link
            </button>
          </div>

          {error ? (
            <div data-cy="login-error" role="alert" class="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          ) : null}

          {tab === "password" ? (
            <form onsubmit={handlePasswordSubmit} class="flex flex-col gap-5">
              <Input id="login-id" name="id" label="Username or Email" required data-cy="login-id" value={email} oninput={onEmailInput} />
              <Input id="login-password" name="password" label="Password" type="password" required data-cy="login-password" />
              <Button type="submit" variant="primary" class="w-full mt-2" data-cy="login-submit">
                Log In
              </Button>
            </form>
          ) : sent ? (
            <div class="text-center py-8">
              <p class="text-primary text-lg font-semibold mb-2">Check your email</p>
              <p class="text-muted text-sm">
                We sent a magic link to your email address. Click the link to log in.
              </p>
            </div>
          ) : (
            <form onsubmit={handleMagicLinkSubmit} class="flex flex-col gap-5">
              <div class="flex flex-col gap-1.5">
                <label for="magic-email" class="text-sm font-medium text-muted">Email</label>
                <input
                  id="magic-email"
                  name="email"
                  type="email"
                  required
                  data-cy="magic-email"
                  value={email}
                  oninput={onEmailInput}
                  class="rounded-lg border border-white/10 bg-card px-4 py-3 text-primary placeholder:text-muted/50 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50"
                />
              </div>
              <Button type="submit" variant="primary" class="w-full mt-2" data-cy="magic-link-submit">
                Send Magic Link
              </Button>
            </form>
          )}

          {/* Divider */}
          <div class="relative my-8">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t border-white/[0.08]" />
            </div>
            <div class="relative flex justify-center text-xs">
              <span class="bg-[var(--bg)] px-3 text-muted">or continue with</span>
            </div>
          </div>

          {/* OAuth buttons */}
          <div class="flex flex-col gap-3">
            <a
              href="/api/oauth/google"
              data-cy="google-oauth"
              class="flex items-center justify-center gap-3 w-full py-3 px-4 rounded-lg border border-white/10 bg-white/[0.04] text-primary text-sm font-medium hover:bg-white/[0.08] transition-colors"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </a>
            <a
              href="/api/oauth/apple"
              data-cy="apple-oauth"
              class="flex items-center justify-center gap-3 w-full py-3 px-4 rounded-lg border border-white/10 bg-white/[0.04] text-primary text-sm font-medium hover:bg-white/[0.08] transition-colors"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              Sign in with Apple
            </a>
          </div>

          <div class="text-center mt-6">
            <Link href="/forgot-password" data-cy="forgot-password-link" class="text-sm text-accent hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>
      </main>
    );
  });
}
