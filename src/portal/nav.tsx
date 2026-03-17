import * as Effect from "effect/Effect";
import { AtomRegistry } from "fibrae";
import { NavigatorTag, Link } from "fibrae/router";
import type { VElement } from "fibrae";
import { DfgApi } from "./api.js";
import { currentUser, isAdmin } from "./auth.js";
import { Button } from "../ui/button.js";

const navLinkClass = "text-muted no-underline text-sm transition-colors hover:text-primary";

export function PortalNav() {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const api = yield* DfgApi;

    // Populate currentUser if not already set (handles page refresh)
    const user = registry.get(currentUser);
    if (!user) {
      const { user: me } = yield* api.auth.me({});
      if (me) registry.set(currentUser, me);
    }

    const admin = isAdmin(registry.get(currentUser));

    const onLogout = (e: Event) =>
      Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.auth.logout({});
        const reg = yield* AtomRegistry.AtomRegistry;
        reg.set(currentUser, null);
        const navigator = yield* NavigatorTag;
        yield* navigator.go("/login");
      });

    return (
      <nav data-cy="portal-nav" class="fixed top-0 w-full px-8 py-3 flex justify-between items-center bg-surface/90 backdrop-blur-md z-[100] border-b border-white/5">
        <div class="font-bold text-lg tracking-tight">
          dfg<span class="text-accent">.</span>rocks
          <span class="text-muted text-sm font-normal ml-2">portal</span>
        </div>
        <div class="flex items-center gap-6">
          <Link href="/dashboard" class={navLinkClass} data-cy="nav-courses">Courses</Link>
          <Link href="/library" class={navLinkClass} data-cy="nav-library">Library</Link>
          <Link href="/assignments" class={navLinkClass} data-cy="nav-assignments">Assignments</Link>
          <Link href="/messages" class={navLinkClass} data-cy="nav-messages">Messages</Link>
          {admin ? <Link href="/students" class={navLinkClass} data-cy="nav-students">Students</Link> : null}
          {admin ? <Link href="/submissions" class={navLinkClass} data-cy="nav-submissions">Submissions</Link> : null}
          <Button variant="ghost" onclick={onLogout} data-cy="logout">Log Out</Button>
        </div>
      </nav>
    );
  });
}
