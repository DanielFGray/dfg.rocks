import { Effect } from "effect";
import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import * as S from "effect/Schema";
import { api } from "../lib/api.js";
import { getErrorMessage } from "../lib/errors.js";
import { TokenSearch } from "../../shared/schemas.js";

export const Route = createFileRoute("/verify-email")({
  head: () => ({ meta: [{ title: "Verify Email | DFG Portal" }] }),
  validateSearch: (
    search: Record<string, unknown>,
  ): S.Schema.Type<typeof TokenSearch> =>
    S.decodeUnknownSync(TokenSearch)(search),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token } = Route.useSearch();

  const verify = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Missing verification token");
      await Effect.runPromise(api.public.verifyEmail({ payload: { token } }));
    },
  });

  useEffect(() => {
    if (token) {
      verify.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold text-primary dark:text-primary-dark">
            Invalid Link
          </h1>
          <p className="mb-6 text-sm text-muted dark:text-muted-dark">
            This verification link is missing a token.
          </p>
          <Link
            to="/login"
            search={{ redirect: undefined }}
            className="text-sm text-accent hover:underline"
          >
            Back to login
          </Link>
        </div>
      </main>
    );
  }

  if (verify.isError) {
    const message = getErrorMessage(verify.error, "Verification failed");
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold text-primary dark:text-primary-dark">
            Verification Failed
          </h1>
          <p className="mb-6 text-sm text-muted dark:text-muted-dark">
            {message}
          </p>
          <Link
            to="/login"
            search={{ redirect: undefined }}
            className="text-sm text-accent hover:underline"
          >
            Back to login
          </Link>
        </div>
      </main>
    );
  }

  if (verify.isSuccess) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold text-primary dark:text-primary-dark">
            Email Verified
          </h1>
          <p className="mb-6 text-sm text-muted dark:text-muted-dark">
            Your email has been verified successfully.
          </p>
          <Link to="/dashboard" className="text-sm text-accent hover:underline">
            Go to dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <p className="text-sm text-muted dark:text-muted-dark">
          Verifying your email...
        </p>
      </div>
    </main>
  );
}
