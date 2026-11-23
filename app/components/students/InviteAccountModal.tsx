import { useState } from "react";
import { Effect, Schema as S } from "effect";
import { Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { getErrorMessage } from "../../lib/errors.js";
import { fieldError } from "../../lib/form.js";
import { emailValidator, requiredValidator } from "../../lib/validators.js";
import { FamilyInviteRole, type Family } from "../../../shared/schemas.js";
import { InviteAccountPayload, type InviteAccountResult } from "../../../shared/api/invitations.js";
import { Modal } from "../ui/Modal.js";
import { Input } from "../ui/Input.js";
import { Select } from "../ui/Select.js";
import { Textarea } from "../ui/Textarea.js";
import { Button } from "../ui/Button.js";

type Person = InviteAccountResult["person"];

const NO_FAMILY = "none";

/**
 * Staff invite a student or parent: the account exists as soon as this succeeds, and the
 * person gets an email with a login link. An email that an account already holds is not
 * invited; the form links to that account instead.
 */
export function InviteAccountModal({
  open,
  onClose,
  families,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  families: readonly Family[];
  onInvited: (person: Person) => void;
}) {
  const [taken, setTaken] = useState<Person | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: typeof InviteAccountPayload.Type) =>
      Effect.runPromise(api.invitationsStaff.inviteAccount({ payload })),
  });

  const close = () => {
    form.reset();
    mutation.reset();
    setTaken(null);
    onClose();
  };

  const form = useForm({
    defaultValues: {
      name: "",
      email: "",
      role: "student",
      familyId: NO_FAMILY,
      message: "",
    },
    onSubmit: async ({ value }) => {
      setTaken(null);
      const result = await mutation.mutateAsync({
        name: value.name.trim(),
        email: value.email.trim(),
        role: S.decodeUnknownSync(FamilyInviteRole)(value.role),
        family_id: value.familyId === NO_FAMILY ? undefined : value.familyId,
        message: value.message.trim() || undefined,
      });
      if (result._tag === "EmailTaken") {
        setTaken(result.person);
        return;
      }
      onInvited(result.person);
      close();
    },
  });

  return (
    <Modal open={open} onClose={close} title="Invite a Student or Parent">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        data-testid="invite-form"
        className="flex flex-col gap-4"
      >
        <form.Field name="name" validators={requiredValidator}>
          {(field) => (
            <Input
              id="invite-name"
              name="name"
              label="Name"
              required
              value={field.state.value}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              error={fieldError(field.state.meta.errors)}
            />
          )}
        </form.Field>
        <form.Field name="email" validators={emailValidator}>
          {(field) => (
            <Input
              id="invite-email"
              name="email"
              label="Email"
              type="email"
              required
              value={field.state.value}
              onChange={(value) => {
                setTaken(null);
                field.handleChange(value);
              }}
              onBlur={field.handleBlur}
              error={fieldError(field.state.meta.errors)}
            />
          )}
        </form.Field>
        {taken ? (
          <p data-testid="invite-email-taken" className="text-sm text-red-600 dark:text-red-400">
            This email already has an account:{" "}
            <Link
              to="/people/$id"
              params={{ id: taken.id }}
              className="font-semibold text-accent hover:underline"
            >
              {taken.name ?? taken.username}
            </Link>
            . Add them to a family from their page.
          </p>
        ) : null}
        <form.Field name="role">
          {(field) => (
            <Select
              id="invite-role"
              name="role"
              label="Role"
              value={field.state.value}
              onChange={field.handleChange}
              options={[
                { value: "student", label: "Student" },
                { value: "parent", label: "Parent" },
              ]}
            />
          )}
        </form.Field>
        <form.Field name="familyId">
          {(field) => (
            <Select
              id="invite-family"
              name="family_id"
              label="Family"
              value={field.state.value}
              onChange={field.handleChange}
              options={[
                { value: NO_FAMILY, label: "No family (pays for themself)" },
                ...families.map((f) => ({ value: f.id, label: f.name })),
              ]}
            />
          )}
        </form.Field>
        <form.Field name="message">
          {(field) => (
            <Textarea
              id="invite-message"
              name="message"
              label="Message (optional)"
              rows={4}
              value={field.state.value}
              onChange={field.handleChange}
              placeholder="Shown in the email and when they first log in"
              data-testid="invite-message"
            />
          )}
        </form.Field>
        {mutation.isError ? (
          <p data-testid="invite-error" className="text-sm text-red-600 dark:text-red-400">
            {getErrorMessage(mutation.error, "Could not send the invitation")}
          </p>
        ) : null}
        <div className="mt-2 flex justify-end gap-3">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Sending..." : "Send Invite"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
