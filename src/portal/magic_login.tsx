import * as Effect from "effect/Effect";
import { AtomRegistry } from "fibrae";
import { NavigatorTag, Link } from "fibrae/router";
import type { VElement } from "fibrae";
import { DfgApi } from "./api.js";
import { currentUser } from "./auth.js";

export function MagicLoginPage() {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const api = yield* DfgApi;
    const navigator = yield* NavigatorTag;

    // Read token from URL
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      return (
        <main class="min-h-screen flex items-center justify-center px-4">
          <div class="text-center">
            <h1 class="text-2xl font-bold text-primary mb-4">Invalid Link</h1>
            <p class="text-muted text-sm mb-6">This magic link is missing a token.</p>
            <Link href="/login" class="text-accent hover:underline text-sm">Back to login</Link>
          </div>
        </main>
      );
    }

    const result = yield* Effect.either(api.auth.verifyMagicLink({ payload: { token } }));

    if (result._tag === "Left") {
      const err = result.left;
      const message = typeof err === "object" && err !== null && "error" in err
        ? (err as { error: string }).error
        : String(err);
      return (
        <main class="min-h-screen flex items-center justify-center px-4">
          <div class="text-center">
            <h1 class="text-2xl font-bold text-primary mb-4">Link Expired</h1>
            <p class="text-muted text-sm mb-6">{message}</p>
            <Link href="/login" class="text-accent hover:underline text-sm">Back to login</Link>
          </div>
        </main>
      );
    }

    registry.set(currentUser, result.right);
    yield* navigator.go("/dashboard");

    return <div /> as VElement;
  });
}
