import { Option, Schema as S } from "effect";
import { createServerFn } from "@tanstack/react-start";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "../components/ui/Button.js";
import { Card } from "../components/ui/Card.js";
import { claimInvitation } from "../lib/authForms.js";
import { runServerEffect } from "../lib/serverEffect.js";
import { Invitations } from "../../server/services/invitations.js";
import { InvitationId } from "../../shared/api/invitations.js";

const InviteSearch = S.Struct({
  id: S.optional(S.String),
  token: S.optional(S.String),
  error: S.optional(S.String),
});

/** Reads the invitation without using it up: a mail scanner that fetches the link changes nothing. */
const getInvitePreview = createServerFn({ method: "GET" })
  .validator((data: unknown) => S.decodeUnknownSync(InviteSearch)(data))
  .handler(async ({ data }) => {
    if (!data.id || !data.token || !S.is(InvitationId)(data.id)) return null;
    const preview = await runServerEffect(
      Invitations.use((invitations) => invitations.preview(data.id ?? "", data.token ?? "")),
    );
    return Option.getOrNull(preview);
  });

export const Route = createFileRoute("/invite")({
  head: () => ({ meta: [{ title: "Welcome | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => S.decodeUnknownSync(InviteSearch)(search),
  loaderDeps: ({ search }) => ({ id: search.id, token: search.token }),
  loader: ({ deps }) => getInvitePreview({ data: deps }),
  component: InvitePage,
});

function InvitePage() {
  const { id, token, error } = Route.useSearch();
  const preview = Route.useLoaderData();

  if (!preview || !id || !token) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">
          <Card className="text-center">
            <h1 data-testid="invite-invalid" className="text-3xl font-bold tracking-tight">
              Link not valid
            </h1>
            <p className="mt-3 text-sm text-muted dark:text-muted-dark">
              This invitation link is wrong, expired, or already used. If you already set up your
              account, log in. Otherwise ask for a new invitation.
            </p>
            <div className="mt-6 flex justify-center">
              <Link to="/login" className="text-sm font-medium text-accent hover:underline">
                Go to login
              </Link>
            </div>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main data-testid="invite-page" className="flex min-h-screen items-center px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <Card>
          <h1 className="text-center text-3xl font-bold tracking-tight">
            Welcome{preview.name ? `, ${preview.name}` : ""}!
          </h1>
          <p className="mt-2 text-center text-sm text-muted dark:text-muted-dark">
            {preview.inviterName ?? "Your teacher"} made you a DFG Portal account.
          </p>
          {preview.message ? (
            <blockquote
              data-testid="invite-message"
              className="mt-6 border-l-4 border-accent/50 pl-4 text-sm whitespace-pre-line"
            >
              {preview.message}
            </blockquote>
          ) : null}
          {error ? (
            <div
              data-testid="invite-error"
              role="alert"
              className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
            >
              {error}
            </div>
          ) : null}
          <form method="post" action={claimInvitation.url} className="mt-8">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="token" value={token} />
            <Button type="submit" className="w-full" data-testid="invite-continue">
              Continue
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
