import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import * as v from "valibot";
import { api } from "../../lib/api.js";
import { getStudentsIndexPageData } from "../../lib/routeData.js";
import { fieldError } from "../../lib/form.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Input } from "../../components/ui/Input.js";
import { Select } from "../../components/ui/Select.js";
import { Modal } from "../../components/ui/Modal.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { QrInviteModal } from "../../components/students/QrInviteModal.js";

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/students/")({
  head: () => ({ meta: [{ title: "Students | DFG Portal" }] }),
  loader: () => getStudentsIndexPageData(),
  component: StudentsPage,
  pendingComponent: () => <div>Loading...</div>,
});

function StudentsPage() {
  const router = useRouter();
  const { students, families } = Route.useLoaderData();

  const [formOpen, setFormOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const inviteMutation = useMutation({
    mutationFn: async ({ familyId, email }: { familyId: string; email: string }) => {
      const { data, error } = await api.admin.families({ familyId }).invite.post({ email });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      void router.invalidate();
    },
  });

  const openForm = () => setFormOpen(true);
  const closeForm = () => {
    setFormOpen(false);
    inviteForm.reset();
  };

  const requiredValidator = {
    onChange: v.pipe(v.string(), v.minLength(1, "Required")),
  };

  const emailValidator = {
    onChange: v.pipe(v.string(), v.minLength(1, "Required"), v.email("Invalid email")),
  };

  const inviteForm = useForm({
    defaultValues: {
      familyId: families[0]?.id ?? "",
      email: "",
    },
    onSubmit: async ({ value }) => {
      inviteMutation.mutate(value, {
        onSuccess: () => closeForm(),
      });
    },
  });

  return (
    <main data-testid="students" className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Students</h1>
        <div className="gap-3 flex">
          <Button variant="ghost" onClick={() => setQrOpen(true)} data-testid="add-via-qr">
            Add via QR
          </Button>
          <Button onClick={openForm} data-testid="invite-student">
            Invite Student
          </Button>
        </div>
      </div>

      {students.length === 0 ? (
        <EmptyState
          message="No students yet."
          action={{ label: "Invite Student", onClick: openForm }}
        />
      ) : (
        <div className="gap-3 flex flex-col">
          {students.map((s) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between">
                <div>
                  <Link
                    to="/students/$id"
                    params={{ id: s.id }}
                    className="font-semibold text-primary dark:text-primary-dark hover:text-accent no-underline transition-colors"
                  >
                    {s.name}
                  </Link>
                  <span className="text-muted dark:text-muted-dark text-sm ml-3">
                    @{s.username}
                  </span>
                  <span className="text-muted/60 dark:text-muted-dark/60 text-sm ml-3">
                    {s.email}
                  </span>
                </div>
                <Link
                  to="/students/$id"
                  params={{ id: s.id }}
                  className="text-xs text-muted dark:text-muted-dark hover:text-accent no-underline transition-colors"
                >
                  View &rarr;
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={formOpen} onClose={closeForm} title="Invite Student to Family">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void inviteForm.handleSubmit();
          }}
          data-testid="invite-form"
          className="gap-4 flex flex-col"
        >
          <inviteForm.Field name="familyId" validators={requiredValidator}>
            {(field) => (
              <Select
                id="invite-family"
                name="family_id"
                label="Family"
                required
                value={field.state.value}
                onChange={field.handleChange}
                options={families.map((f) => ({
                  value: f.id,
                  label: f.name,
                }))}
                error={fieldError(field.state.meta.errors)}
              />
            )}
          </inviteForm.Field>
          <inviteForm.Field name="email" validators={emailValidator}>
            {(field) => (
              <Input
                id="invite-email"
                name="email"
                label="Email"
                type="email"
                required
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                error={fieldError(field.state.meta.errors)}
              />
            )}
          </inviteForm.Field>
          <div className="gap-3 mt-2 flex justify-end">
            <Button variant="ghost" onClick={closeForm}>
              Cancel
            </Button>
            <Button type="submit" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? "Sending..." : "Send Invite"}
            </Button>
          </div>
        </form>
      </Modal>

      <QrInviteModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        families={families}
        onSuccess={() => void router.invalidate()}
      />
    </main>
  );
}
