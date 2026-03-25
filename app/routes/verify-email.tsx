import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export const Route = createFileRoute("/verify-email")({
  head: () => ({ meta: [{ title: "Verify Email | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) ?? "",
  }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token } = Route.useSearch();

  const verify = useMutation({
    mutationFn: async () => {
      const { error } = await api["verify-email"].post({ token });
      if (error) throw error;
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
          <h1 className="mb-4 text-2xl font-bold text-primary">Invalid Link</h1>
          <p className="mb-6 text-sm text-muted">This verification link is missing a token.</p>
          <Link to="/login" className="text-sm text-accent hover:underline">Back to login</Link>
        </div>
      </main>
    );
  }

  if (verify.isError) {
    const message = (verify.error as any)?.value?.error ?? verify.error.message;
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold text-primary">Verification Failed</h1>
          <p className="mb-6 text-sm text-muted">{message}</p>
          <Link to="/login" className="text-sm text-accent hover:underline">Back to login</Link>
        </div>
      </main>
    );
  }

  if (verify.isSuccess) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-4 text-2xl font-bold text-primary">Email Verified</h1>
          <p className="mb-6 text-sm text-muted">Your email has been verified successfully.</p>
          <Link to="/dashboard" className="text-sm text-accent hover:underline">Go to dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <p className="text-sm text-muted">Verifying your email...</p>
      </div>
    </main>
  );
}
