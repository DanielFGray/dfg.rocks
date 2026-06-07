import { Effect } from "effect";
import { useEffect } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { consumeLoginRedirect, normalizeLoginRedirect } from "../lib/loginRedirect.js";
import { getErrorMessage } from "../lib/errors.js";
import { resetAuthClientState } from "../lib/authClientState.js";

export const Route = createFileRoute("/magic-login")({
  head: () => ({ meta: [{ title: "Magic Link Login | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
    redirect: normalizeLoginRedirect(search.redirect),
  }),
  component: MagicLoginPage,
});

function MagicLoginPage() {
  const { token, redirect } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();

  const verify = useMutation({
    mutationFn: () => {
      if (!token) throw new Error("Missing magic link token");
      return Effect.runPromise(api.auth.verifyMagicLink({ payload: { token } }));
    },
    onSuccess: async () => {
      await resetAuthClientState({ queryClient, router });
      const nextRedirect = consumeLoginRedirect(redirect);
      if (nextRedirect) {
        window.location.assign(nextRedirect);
        return;
      }
      navigate({ to: "/dashboard" });
    },
  });

  useEffect(() => {
    if (token) {
      verify.mutate();
    }
  }, [token]);

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold text-primary dark:text-primary-dark">
            Invalid Link
          </h1>
          <p className="mb-6 text-sm text-muted dark:text-muted-dark">
            This magic link is missing a token.
          </p>
          <Link to="/login" search={{ redirect }} className="text-sm text-accent hover:underline">
            Back to login
          </Link>
        </div>
      </main>
    );
  }

  if (verify.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold text-primary dark:text-primary-dark">
            Link Expired
          </h1>
          <p className="mb-6 text-sm text-muted dark:text-muted-dark">
            {getErrorMessage(verify.error, "Link expired")}
          </p>
          <Link to="/login" search={{ redirect }} className="text-sm text-accent hover:underline">
            Back to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <p className="text-sm text-muted dark:text-muted-dark">Verifying magic link...</p>
      </div>
    </main>
  );
}
