import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../lib/api.js";

export const Route = createFileRoute("/magic-login")({
  head: () => ({ meta: [{ title: "Magic Link Login | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) ?? "",
  }),
  component: MagicLoginPage,
});

function MagicLoginPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const verify = useMutation({
    mutationFn: async () => {
      const { data, error } = await api["magic-link"].verify.post({ token });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate({ to: "/dashboard" });
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
          <p className="mb-6 text-sm text-muted">This magic link is missing a token.</p>
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
          <h1 className="mb-4 text-2xl font-bold text-primary">Link Expired</h1>
          <p className="mb-6 text-sm text-muted">{message}</p>
          <Link to="/login" className="text-sm text-accent hover:underline">Back to login</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <p className="text-sm text-muted">Verifying magic link...</p>
      </div>
    </main>
  );
}
