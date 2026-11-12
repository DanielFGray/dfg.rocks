import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import * as S from "effect/Schema";
import { getErrorMessage } from "../lib/errors.js";
import { fieldError } from "../lib/form.js";
import { passwordValidator } from "../lib/validators.js";
import { Button } from "../components/ui/Button.js";
import { Input } from "../components/ui/Input.js";
import { TokenSearch } from "../../shared/schemas.js";
import { resetPassword } from "../lib/authForms.js";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset Password | DFG Portal" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    ...S.decodeSync(TokenSearch)(search),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token, error: searchError } = Route.useSearch();

  const form = useForm({
    defaultValues: { password: "", confirm: "" },
  });

  const submitError = form.state.errorMap.onSubmit
    ? getErrorMessage(form.state.errorMap.onSubmit, "Password reset failed")
    : null;
  const serverError = searchError ?? submitError;

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-4 text-3xl font-bold tracking-tight">Invalid Link</h1>
          <p className="text-sm text-muted dark:text-muted-dark">
            This link is missing a token. Please use the link from your reset email.
          </p>
          <Link to="/login" className="mt-6 inline-block text-sm text-accent hover:underline">
            Back to Log In
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main
      data-testid="reset-password-page"
      className="flex min-h-screen items-center justify-center px-4"
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Reset Password</h1>
          <p className="mt-2 text-sm text-muted dark:text-muted-dark">Enter your new password</p>
        </div>
        <form
          method="post"
          action={resetPassword.url}
          onSubmit={(e) => {
            const password = form.getFieldValue("password");
            const confirm = form.getFieldValue("confirm");
            if (!password || password.length < 6 || password !== confirm) {
              e.preventDefault();
              void form.validateAllFields("submit");
            }
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
          <input type="hidden" name="token" value={token} />
          <form.Field name="password" validators={passwordValidator}>
            {(field) => (
              <Input
                id="reset-password"
                name="password"
                label="New Password"
                required
                minLength={6}
                autoComplete="new-password"
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
                if (value !== form.getFieldValue("password")) return "Passwords do not match";
                return undefined;
              },
            }}
          >
            {(field) => (
              <Input
                id="reset-password-confirm"
                name="confirm"
                label="Confirm New Password"
                required
                minLength={6}
                autoComplete="new-password"
                type="password"
                data-testid="reset-password-confirm"
                value={field.state.value}
                onChange={(v) => field.handleChange(v)}
                onBlur={() => field.handleBlur()}
                error={fieldError(field.state.meta.errors)}
              />
            )}
          </form.Field>
          <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button
                type="submit"
                variant="primary"
                className="mt-2 w-full"
                data-testid="reset-password-submit"
                disabled={!canSubmit || isSubmitting}
              >
                {isSubmitting ? "Resetting..." : "Reset Password"}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </div>
    </main>
  );
}
