import { useState } from "react";
import { AddStudentForm } from "../AddStudentForm.js";
import { Card } from "../ui/Card.js";

/** The dashboard of a parent whose family has no students yet. */
export function ParentOnboarding({ onSuccess }: { onSuccess?: () => void }) {
  const [name, setName] = useState("");

  return (
    <Card data-testid="parent-onboarding">
      <div className="grid gap-8 px-1 py-2 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-semibold tracking-[0.2em] text-accent uppercase">
              Parent Setup
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-primary">
              Add your first student
            </h2>
            <p className="max-w-xl text-sm text-muted">
              Start by creating your child{"’"}s student profile. They{"’"}ll appear across lessons,
              assignments, messages, and booking right away.
            </p>
          </div>

          <div className="rounded-2xl border border-overlay/8 bg-overlay/3 p-4">
            <p className="text-sm font-medium text-primary">
              What happens next
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">
              <li>Your child gets a student profile in this family.</li>
              <li>They won{"’"}t have a password or direct login by default.</li>
              <li>You can switch into their view when booking lessons or sending messages.</li>
            </ul>
          </div>
        </div>

        <AddStudentForm name={name} onNameChange={setName} onAdded={onSuccess} />
      </div>
    </Card>
  );
}
