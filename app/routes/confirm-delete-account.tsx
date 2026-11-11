import * as S from "effect/Schema";
import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie } from "@tanstack/react-start/server";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { decodeAuthState, getAuthUser } from "../lib/auth.js";
import { Card } from "../components/ui/Card.js";
import { TokenSearch } from "../../shared/schemas.js";
import { runServerEffect } from "../lib/serverEffect.js";
import { HttpError } from "../../server/pgErrors.js";
import { SessionService } from "../../server/services/sessionService.js";
import { AccountService } from "../../server/services/accountService.js";

const confirmDeleteAccountAction = createServerFn({ method: "POST" })
  .validator((data) => {
    if (!(data instanceof FormData)) throw new Error("FormData expected");
    return {
      token: String(data.get("token") ?? ""),
    };
  })
  .handler(async ({ data }) => {
    const sessionToken = getCookie("session");
    const auth = await runServerEffect(
      SessionService.use((sessionService) => sessionService.validateSessionToken(sessionToken)),
    );
    if (!auth) {
      throw redirect({
        to: "/login",
        search: { redirect: `/confirm-delete-account?token=${encodeURIComponent(data.token)}` },
      });
    }

    const deleted = await runServerEffect(
      AccountService.use((accountService) =>
        accountService.confirmDeleteAccount(auth.session.id, data.token),
      ),
    );

    if (!deleted) {
      throw new HttpError(400, "Invalid or expired deletion token");
    }

    await runServerEffect(
      SessionService.use((sessionService) => sessionService.deleteAllUserSessions(auth.user.id)),
    );
    deleteCookie("session");
    throw redirect({ to: "/" });
  });

export const Route = createFileRoute("/confirm-delete-account")({
  head: () => ({ meta: [{ title: "Confirm Delete Account | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>): S.Schema.Type<typeof TokenSearch> =>
    S.decodeUnknownSync(TokenSearch)(search),
  loader: async () => decodeAuthState(await getAuthUser()),
  component: ConfirmDeleteAccountPage,
});

function ConfirmDeleteAccountPage() {
  const { token } = Route.useSearch();
  const { user } = Route.useLoaderData();

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">
          <Card className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Invalid Link</h1>
            <p className="mt-3 text-sm text-muted dark:text-muted-dark">
              This delete-account link is missing its confirmation token.
            </p>
            <div className="mt-6 flex justify-center">
              <Link to="/" className="text-sm font-medium text-accent hover:underline">
                Back to home
              </Link>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  const redirectTo = `/confirm-delete-account?token=${encodeURIComponent(token)}`;

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">
          <Card className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Sign In Required</h1>
            <p className="mt-3 text-sm text-muted dark:text-muted-dark">
              Sign in to the account that requested deletion before confirming this action.
            </p>
            <div className="mt-6 flex justify-center">
              <Link
                to="/login"
                search={{ redirect: redirectTo }}
                className="text-sm font-medium text-accent hover:underline"
              >
                Go to Log In
              </Link>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main
      data-testid="confirm-delete-account-page"
      className="flex min-h-screen items-center justify-center px-4"
    >
      <div className="w-full max-w-md">
        <Card>
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Delete Account</h1>
            <p className="mt-3 text-sm text-muted dark:text-muted-dark">
              You&apos;re about to permanently delete the account for{" "}
              <span className="font-semibold text-primary dark:text-primary-dark">
                {user.email || user.username}
              </span>
              .
            </p>
            <p className="mt-2 text-sm text-muted dark:text-muted-dark">
              This action removes your access to the student portal and cannot be undone.
            </p>
          </div>

          <div className="mt-6 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-4 text-sm text-muted dark:text-muted-dark">
            <p className="font-medium text-red-600 dark:text-red-400">Before you continue</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Your lessons, messages, and account access will be removed.</li>
              <li>You must be signed in to the same account that requested deletion.</li>
              <li>If this link is old, request a fresh delete email from settings.</li>
            </ul>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Link
              to="/settings"
              className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-semibold text-muted transition-colors hover:bg-overlay/5 hover:text-primary dark:text-muted-dark dark:hover:bg-overlay-dark/5 dark:hover:text-primary-dark"
            >
              Cancel
            </Link>
            <form method="post" action={confirmDeleteAccountAction.url}>
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                data-testid="confirm-delete-account-submit"
                className="inline-flex items-center justify-center rounded-xl bg-red-600 px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-red-500"
              >
                Delete Account
              </button>
            </form>
          </div>
        </Card>
      </div>
    </main>
  );
}
