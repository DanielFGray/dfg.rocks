import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "fibrae";
import type { VElement } from "fibrae";
import { Link } from "fibrae/router";
import { DfgApi } from "./api.js";
import { emailValue } from "./auth.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";

const formSubmitted = Atom.make(false);

export function ForgotPasswordPage() {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const submitted = registry.get(formSubmitted);
    const email = registry.get(emailValue);

    const onEmailInput = (e: Event) => {
      const target = e.target as HTMLInputElement;
      registry.set(emailValue, target.value);
    };

    const handleSubmit = (e: Event) => {
      e.preventDefault();

      return Effect.gen(function* () {
        const api = yield* DfgApi;
        const reg = yield* AtomRegistry.AtomRegistry;
        const currentEmail = reg.get(emailValue);
        // always show success — don't reveal if email exists
        yield* Effect.either(api.auth.forgotPassword({ payload: { email: currentEmail } }));
        registry.set(formSubmitted, true);
      });
    };

    if (submitted) {
      return (
        <main data-cy="forgot-password-page" class="min-h-screen flex items-center justify-center px-4">
          <div class="w-full max-w-sm text-center">
            <h1 class="text-3xl font-bold tracking-tight mb-4">Check Your Email</h1>
            <p class="text-muted text-sm">
              If an account exists with that email, we've sent a password reset link. Check your inbox.
            </p>
            <Link href="/login" data-cy="back-to-login" class="inline-block mt-6 text-sm text-accent hover:underline">
              Back to Log In
            </Link>
          </div>
        </main>
      );
    }

    return (
      <main data-cy="forgot-password-page" class="min-h-screen flex items-center justify-center px-4">
        <div class="w-full max-w-sm">
          <div class="text-center mb-8">
            <h1 class="text-3xl font-bold tracking-tight">Forgot Password</h1>
            <p class="text-muted mt-2 text-sm">Enter your email and we'll send a reset link</p>
          </div>
          <form onsubmit={handleSubmit} class="flex flex-col gap-5">
            <Input id="forgot-email" name="email" label="Email" type="email" required data-cy="forgot-email" value={email} oninput={onEmailInput} />
            <Button type="submit" variant="primary" class="w-full mt-2" data-cy="forgot-submit">
              Send Reset Link
            </Button>
          </form>
          <div class="text-center mt-6">
            <Link href="/login" class="text-sm text-accent hover:underline">
              Back to Log In
            </Link>
          </div>
        </div>
      </main>
    );
  });
}
