import * as S from "effect/Schema";
import { createServerFn } from "@tanstack/react-start";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TokenSearch } from "../../shared/schemas.js";
import { runServerEffect } from "../lib/serverEffect.js";
import { PublicRouteService } from "../../server/services/publicRouteService.js";

const verifyEmailPageData = createServerFn({ method: "GET" })
  .validator((data: unknown) => S.decodeUnknownSync(TokenSearch)(data))
  .handler(async ({ data }) => {
    const token = data.token;
    if (!token) {
      return { status: "missing-token" as const, error: null };
    }

    try {
      await runServerEffect(
        PublicRouteService.use((publicRouteService) => publicRouteService.verifyEmail(token)),
      );
      return { status: "verified" as const, error: null };
    } catch (error) {
      return {
        status: "error" as const,
        error: error instanceof Error ? error.message : "Verification failed",
      };
    }
  });

export const Route = createFileRoute("/verify-email")({
  head: () => ({ meta: [{ title: "Verify Email | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>): S.Schema.Type<typeof TokenSearch> =>
    S.decodeUnknownSync(TokenSearch)(search),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: ({ deps }) => verifyEmailPageData({ data: deps }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { status, error } = Route.useLoaderData();

  if (status === "missing-token") {
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

  if (status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold text-primary dark:text-primary-dark">
            Verification Failed
          </h1>
          <p className="mb-6 text-sm text-muted dark:text-muted-dark">{error}</p>
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
