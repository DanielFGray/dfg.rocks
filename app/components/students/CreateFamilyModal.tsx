import { useForm } from "@tanstack/react-form";
import { fieldError } from "../../lib/form.js";
import { requiredValidator } from "../../lib/validators.js";
import { Modal } from "../ui/Modal.js";
import { Input } from "../ui/Input.js";
import { Button } from "../ui/Button.js";

export function CreateFamilyModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: { slug: string; name: string }) => void;
}) {
  const form = useForm({
    defaultValues: {
      name: "",
      slug: "",
    },
    onSubmit: async ({ value }) => {
      onSubmit({ name: value.name, slug: value.slug });
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Create Family">
      <form
        data-testid="create-family-form"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
        className="flex flex-col gap-5"
      >
        <form.Field name="name" validators={requiredValidator}>
          {(field) => (
            <Input
              id="family-name"
              name="name"
              label="Family Name"
              type="text"
              placeholder="Smith Family"
              value={field.state.value}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              error={fieldError(field.state.meta.errors)}
              data-testid="family-name-input"
            />
          )}
        </form.Field>

        <form.Field name="slug" validators={requiredValidator}>
          {(field) => (
            <Input
              id="family-slug"
              name="slug"
              label="Slug"
              type="text"
              placeholder="smith"
              value={field.state.value}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              error={fieldError(field.state.meta.errors)}
              data-testid="family-slug-input"
            />
          )}
        </form.Field>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <form.Subscribe selector={(s) => s.canSubmit}>
            {(canSubmit) => (
              <Button
                type="submit"
                variant="primary"
                disabled={!canSubmit}
                data-testid="create-family-submit"
              >
                Create Family
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </Modal>
  );
}
