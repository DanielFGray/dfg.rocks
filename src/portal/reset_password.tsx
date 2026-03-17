import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "fibrae";
import { NavigatorTag, Link } from "fibrae/router";
import type { VElement } from "fibrae";
import { DfgApi } from "./api.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";

const formError = Atom.make<string | null>(null);
const formSuccess = Atom.make(false);

export function ResetPasswordPage() {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const error = registry.get(formError);
    const success = registry.get(formSuccess);

    const token = new URLSearchParams(window.location.search).get("token");

    const handleSubmit = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const data = new FormData(form);
      const password = data.get("password") as string;
      const confirm = data.get("confirm") as string;

      registry.set(formError, null);

      if (password !== confirm) {
        registry.set(formError, "Passwords do not match");
        return Effect.void;
      }

      if (!token) {
        registry.set(formError, "Missing token. Please use the link from your reset email.");
        return Effect.void;
      }

      return Effect.gen(function* () {
        const api = yield* DfgApi;
        const result = yield* Effect.either(api.auth.resetPassword({ payload: { token, password } }));

        if (result._tag === "Left") {
          const err = result.left;
          const message = typeof err === "object" && err !== null && "error" in err
            ? (err as { error: string }).error
            : String(err);
          registry.set(formError, message);
          return;
        }

        registry.set(formSuccess, true);
        const navigator = yield* NavigatorTag;
        yield* navigator.go("/login");
      });
    };

    if (!token) {
      return (
        <main class="min-h-screen flex items-center justify-center px-4">
          <div class="w-full max-w-sm text-center">
            <h1 class="text-3xl font-bold tracking-tight mb-4">Invalid Link</h1>
            <p class="text-muted text-sm">
              This link is missing a token. Please use the link from your reset email.
            </p>
            <Link href="/login" class="inline-block mt-6 text-sm text-accent hover:underline">
              Back to Log In
            </Link>
          </div>
        </main>
      );
    }

    return (
      <main data-cy="reset-password-page" class="min-h-screen flex items-center justify-center px-4">
        <div class="w-full max-w-sm">
          <div class="text-center mb-8">
            <h1 class="text-3xl font-bold tracking-tight">Reset Password</h1>
            <p class="text-muted mt-2 text-sm">Enter your new password</p>
          </div>
          {error ? (
            <div data-cy="reset-password-error" role="alert" class="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          ) : null}
          {success ? (
            <div role="status" class="mb-6 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              Password reset successfully. Redirecting to login...
            </div>
          ) : null}
          <form onsubmit={handleSubmit} class="flex flex-col gap-5">
            <Input id="reset-password" name="password" label="New Password" type="password" required data-cy="reset-password-input" />
            <Input id="reset-password-confirm" name="confirm" label="Confirm New Password" type="password" required data-cy="reset-password-confirm" />
            <Button type="submit" variant="primary" class="w-full mt-2" data-cy="reset-password-submit">
              Reset Password
            </Button>
          </form>
        </div>
      </main>
    );
  });
}
