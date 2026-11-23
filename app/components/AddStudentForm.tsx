import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { useState } from "react";
import { api } from "../lib/api.js";
import { getErrorMessage } from "../lib/errors.js";
import { authUserQuery } from "../lib/queries.js";
import type { StudentInstrument } from "../../shared/studentProfile.js";
import { InstrumentPicker } from "./onboarding/InstrumentPicker.js";
import { Button } from "./ui/Button.js";
import { Input } from "./ui/Input.js";

/**
 * A parent adds a child to their family, with the child's instruments. The caller holds the
 * name, so it can tell whether a student was typed in but not yet added.
 */
export function AddStudentForm({
  name,
  onNameChange,
  onAdded,
}: {
  name: string;
  onNameChange: (name: string) => void;
  onAdded?: () => void;
}) {
  const queryClient = useQueryClient();
  const [instruments, setInstruments] = useState<StudentInstrument[]>([]);
  const add = useMutation({
    mutationFn: () =>
      Effect.runPromise(api.families.createChild({ payload: { name: name.trim(), instruments } })),
    onSuccess: async () => {
      onNameChange("");
      setInstruments([]);
      // The family list and the active student come from the auth state.
      await queryClient.fetchQuery({ ...authUserQuery, staleTime: 0 });
      onAdded?.();
    },
  });
  const nameTooLong = name.length > 200;
  const otherUnnamed = instruments.some(
    (item) => item.instrument === "other" && !item.other_instrument?.trim(),
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <Input
        id="child-name"
        name="name"
        label="Student name"
        placeholder="e.g. Alex Smith"
        value={name}
        onChange={onNameChange}
        disabled={add.isPending}
        autoComplete="off"
        error={nameTooLong ? "Student name must be 200 characters or fewer" : undefined}
        data-testid="child-name-input"
      />
      <InstrumentPicker
        idPrefix="child"
        value={instruments}
        onChange={setInstruments}
        disabled={add.isPending}
      />
      {add.isError ? (
        <p
          role="alert"
          data-testid="add-student-error"
          className="text-sm text-red-600 dark:text-red-400"
        >
          {getErrorMessage(add.error, "Could not add the student")}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="outline"
        disabled={name.trim() === "" || nameTooLong || otherUnnamed || add.isPending}
        data-testid="add-student-submit"
      >
        {add.isPending ? "Adding..." : "Add student"}
      </Button>
    </form>
  );
}
