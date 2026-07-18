import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { useState } from "react";
import { api } from "../../lib/api.js";
import { Card } from "../ui/Card.js";
import { Input } from "../ui/Input.js";

interface Props {
  isFirstStudent: boolean;
  onSuccess?: () => void;
}

export function ParentOnboarding({ isFirstStudent, onSuccess }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");

  const mutation = useMutation({
    mutationFn: (name: string) =>
      Effect.runPromise(api.authenticated.createChild({ payload: { name } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth", "user"] });
      onSuccess?.();
    },
  });

  const error = mutation.error instanceof Error ? mutation.error.message : null;
  const isNameTooLong = name.length > 200;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isNameTooLong) return;
    mutation.mutate(name.trim());
  };

  return (
    <Card data-testid="parent-onboarding">
      <div className="grid gap-8 px-1 py-2 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
              Parent Setup
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-primary dark:text-primary-dark">
              {isFirstStudent ? "Add your first student" : "Add another student"}
            </h2>
            <p className="max-w-xl text-sm text-muted dark:text-muted-dark">
              {isFirstStudent
                ? "Start by creating your child\u2019s student profile. They\u2019ll appear across lessons, assignments, messages, and booking right away."
                : "Create a student profile for another child in your family."}
            </p>
          </div>

          {isFirstStudent ? (
            <div className="rounded-2xl border border-overlay/8 bg-overlay/3 p-4 dark:border-overlay-dark/8 dark:bg-overlay-dark/3">
              <p className="text-sm font-medium text-primary dark:text-primary-dark">What happens next</p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted dark:text-muted-dark">
                <li>Your child gets a student profile in this family.</li>
                <li>They won\u2019t have a password or direct login by default.</li>
                <li>You can switch into their view when booking lessons or sending messages.</li>
              </ul>
            </div>
          ) : null}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <div
              role="alert"
              data-testid="parent-onboarding-error"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
            >
              {error}
            </div>
          ) : null}

          <Input
            id="child-name"
            name="name"
            value={name}
            onChange={setName}
            label="Student Name"
            placeholder="e.g. Alex Smith"
            required
            disabled={mutation.isPending}
            autoComplete="name"
            data-testid="child-name-input"
            error={isNameTooLong ? "Student name must be 200 characters or fewer" : undefined}
          />

          <button
            type="submit"
            disabled={mutation.isPending || !name.trim() || isNameTooLong}
            data-testid="add-student-submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? "Creating..." : "Create Student Profile"}
          </button>

          {isFirstStudent ? (
            <p className="text-xs text-muted dark:text-muted-dark">
              You can add more students later from the portal.
            </p>
          ) : null}
        </form>
      </div>
    </Card>
  );
}
