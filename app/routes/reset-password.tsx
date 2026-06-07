import { Effect } from "effect";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import * as S from "effect/Schema";
import { api } from "../lib/api.js";
import { getErrorMessage } from "../lib/errors.js";
import { fieldError } from "../lib/form.js";
import { passwordValidator } from "../lib/validators.js";
import { Button } from "../components/ui/Button.js";
import { Input } from "../components/ui/Input.js";
import { TokenSearch } from "../../shared/schemas.js";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset Password | DFG Portal" }] }),
  validateSearch: (
    search: Record<string, unknown>,
  ): S.Schema.Type<typeof TokenSearch> =>
    S.decodeUnknownSync(TokenSearch)(search),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();

  const reset = useMutation({
    mutationFn: async (password: string) => {
      if (!token) throw new Error("Missing reset token");
      await Effect.runPromise(
        api.auth.resetPassword({ payload: { token, password } }),
      );
    },
    onSuccess: () => {
      navigate({ to: "/login", search: { redirect: undefined } });
    },
  });

  const form = useForm({
    defaultValues: { password: "", confirm: "" },
    onSubmit: async ({ value }) => {
      reset.mutate(value.password);
    },
  });

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-4 text-3xl font-bold tracking-tight">
            Invalid Link
          </h1>
          <p className="text-sm text-muted dark:text-muted-dark">
            This link is missing a token. Please use the link from your reset
            email.
          </p>
          <Link
            to="/login"
            search={{ redirect: undefined }}
            className="mt-6 inline-block text-sm text-accent hover:underline"
          >
            Back to Log In
          </Link>
        </div>
      </main>
    );
  }

  const serverError = reset.isError
    ? getErrorMessage(reset.error, "Password reset failed")
    : null;

  return (
    <main
      data-testid="reset-password-page"
      className="flex min-h-screen items-center justify-center px-4"
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Reset Password</h1>
          <p className="mt-2 text-sm text-muted dark:text-muted-dark">
            Enter your new password
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
          className="flex flex-col gap-5"
        >
          {serverError ? (
            <div
              data-testid="reset-password-error"
              role="alert"
              className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
            >
              {serverError}
            </div>
          ) : null}
          <form.Field name="password" validators={passwordValidator}>
            {(field) => (
              <Input
                id="reset-password"
                name="password"
                label="New Password"
                type="password"
                data-testid="reset-password-input"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                onBlur={() => field.handleBlur()}
                error={fieldError(field.state.meta.errors)}
              />
            )}
          </form.Field>
          <form.Field
            name="confirm"
            validators={{
              onChangeListenTo: ["password"],
              onChange: ({ value }) => {
                if (value !== form.getFieldValue("password"))
                  return "Passwords do not match";
                return undefined;
              },
            }}
          >
            {(field) => (
              <Input
                id="reset-password-confirm"
                name="confirm"
                label="Confirm New Password"
                type="password"
                data-testid="reset-password-confirm"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                onBlur={() => field.handleBlur()}
                error={fieldError(field.state.meta.errors)}
              />
            )}
          </form.Field>
          <form.Subscribe selector={(s) => [s.canSubmit] as const}>
            {([canSubmit]) => (
              <Button
                type="submit"
                variant="primary"
                className="mt-2 w-full"
                data-testid="reset-password-submit"
                disabled={!canSubmit || reset.isPending}
              >
                {reset.isPending ? "Resetting..." : "Reset Password"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </div>
    </main>
  );
}
