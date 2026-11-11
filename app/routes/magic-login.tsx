import { useEffect } from "react";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { consumeLoginRedirect, normalizeLoginRedirect } from "../lib/loginRedirect.js";
import { runServerEffect } from "../lib/serverEffect.js";
import { AuthService } from "../../server/services/authService.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

const verifyMagicLogin = createServerFn({ method: "GET" })
  .validator((data: Record<string, unknown>) => ({
    token: typeof data.token === "string" ? data.token : undefined,
    redirect: normalizeLoginRedirect(data.redirect),
  }))
  .handler(async ({ data }) => {
    const token = data.token;
    if (!token) {
      return {
        status: "missing-token" as const,
        error: null,
        redirect: data.redirect,
      };
    }

    try {
      const session = await runServerEffect(
        AuthService.use((authService) => authService.consumeMagicLink(token)),
      );
      setCookie("session", session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_TTL_MS / 1000,
        path: "/",
        expires: session.expiresAt,
      });
      return {
        status: "verified" as const,
        error: null,
        redirect: data.redirect,
      };
    } catch (error) {
      return {
        status: "error" as const,
        error: error instanceof Error ? error.message : "Link expired",
        redirect: data.redirect,
      };
    }
  });

export const Route = createFileRoute("/magic-login")({
  head: () => ({ meta: [{ title: "Magic Link Login | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
    redirect: normalizeLoginRedirect(search.redirect),
  }),
  loaderDeps: ({ search }) => ({
    token: search.token,
    redirect: search.redirect,
  }),
  loader: ({ deps }) => verifyMagicLogin({ data: deps }),
  component: MagicLoginPage,
});

function MagicLoginPage() {
  const navigate = useNavigate();
  const data = Route.useLoaderData();

  useEffect(() => {
    if (data.status !== "verified") return;

    const nextRedirect = consumeLoginRedirect(data.redirect);
    if (nextRedirect) {
      window.location.assign(nextRedirect);
      return;
    }

    void navigate({ to: "/dashboard" });
  }, [data, navigate]);

  if (data.status === "missing-token") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold text-primary dark:text-primary-dark">
            Invalid Link
          </h1>
          <p className="mb-6 text-sm text-muted dark:text-muted-dark">
            This magic link is missing a token.
          </p>
          <Link
            to="/login"
            search={{ redirect: data.redirect }}
            className="text-sm text-accent hover:underline"
          >
            Back to login
          </Link>
        </div>
      </main>
    );
  }

  if (data.status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold text-primary dark:text-primary-dark">
            Link Expired
          </h1>
          <p className="mb-6 text-sm text-muted dark:text-muted-dark">{data.error}</p>
          <Link
            to="/login"
            search={{ redirect: data.redirect }}
            className="text-sm text-accent hover:underline"
          >
            Back to login
          </Link>
        </div>
      </main>
    );
  }

  const fallbackRedirect = data.redirect ?? "/dashboard";

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <h1 className="mb-4 text-2xl font-bold text-primary dark:text-primary-dark">
          Magic Link Verified
        </h1>
        <p className="mb-6 text-sm text-muted dark:text-muted-dark">
          You&apos;re signed in. Redirecting now...
        </p>
        <Link to={fallbackRedirect} className="text-sm text-accent hover:underline">
          Continue
        </Link>
      </div>
    </main>
  );
}
