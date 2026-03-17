import * as Effect from "effect/Effect";
import { AtomRegistry } from "fibrae";
import { NavigatorTag } from "fibrae/router";
import type { VChild, VElement } from "fibrae/shared";
import { DfgApi } from "./api.js";
import { currentUser } from "./auth.js";

type AuthGuardProps = {
  children: VChild;
};

/**
 * AuthGuard checks if user is authenticated before rendering children.
 * If no user in atom, fetches /api/me. If still no user, redirects to login.
 */
export function AuthGuard(props: AuthGuardProps) {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const api = yield* DfgApi;
    const navigator = yield* NavigatorTag;

    let user = registry.get(currentUser);

    if (!user) {
      const { user: me } = yield* api.auth.me({});
      if (me) {
        registry.set(currentUser, me);
        user = me;
      }
    }

    if (!user) {
      yield* navigator.go("/login");
      return <div /> as VElement;
    }

    return <div>{props.children}</div> as VElement;
  });
}
