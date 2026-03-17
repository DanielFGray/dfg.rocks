import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "fibrae";
import { NavigatorTag } from "fibrae/router";
import type { VElement } from "fibrae";
import { DfgApi } from "./api.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";

const formError = Atom.make<string | null>(null);
const formSuccess = Atom.make(false);

export function SetPasswordPage() {
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
        registry.set(formError, "Missing token. Please use the link from your invite email.");
        return Effect.void;
      }

      return Effect.gen(function* () {
        const api = yield* DfgApi;
        const result = yield* Effect.either(api.auth.setPassword({ payload: { token, password } }));

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
              This link is missing a token. Please use the link from your invite email.
            </p>
          </div>
        </main>
      );
    }

    return (
      <main data-cy="set-password-page" class="min-h-screen flex items-center justify-center px-4">
        <div class="w-full max-w-sm">
          <div class="text-center mb-8">
            <h1 class="text-3xl font-bold tracking-tight">Set Your Password</h1>
            <p class="text-muted mt-2 text-sm">Create a password to access your account</p>
          </div>
          {error ? (
            <div data-cy="set-password-error" role="alert" class="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          ) : null}
          {success ? (
            <div role="status" class="mb-6 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              Password set successfully. Redirecting...
            </div>
          ) : null}
          <form onsubmit={handleSubmit} class="flex flex-col gap-5">
            <Input id="set-password" name="password" label="Password" type="password" required data-cy="set-password-input" />
            <Input id="set-password-confirm" name="confirm" label="Confirm Password" type="password" required data-cy="set-password-confirm" />
            <Button type="submit" variant="primary" class="w-full mt-2" data-cy="set-password-submit">
              Set Password
            </Button>
          </form>
        </div>
      </main>
    );
  });
}
