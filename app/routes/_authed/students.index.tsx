import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { User, Family } from "../../lib/types.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Input } from "../../components/ui/Input.js";
import { Select } from "../../components/ui/Select.js";
import { Modal } from "../../components/ui/Modal.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

/* ---------------------------------------------------------------------------
 * Query Options
 * --------------------------------------------------------------------------- */

const adminStudentsQuery = queryOptions({
  queryKey: ["admin", "students"],
  queryFn: async () => {
    const { data, error } = await api.admin.students.get();
    if (error) throw error;
    return data;
  },
});

const adminFamiliesQuery = queryOptions({
  queryKey: ["admin", "families"],
  queryFn: async () => {
    const { data, error } = await api.admin.families.get();
    if (error) throw error;
    return data;
  },
});

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/students/")({
  head: () => ({ meta: [{ title: "Students | DFG Portal" }] }),
  loader: async ({ context: { queryClient } }) => {
    await Promise.allSettled([
      queryClient.ensureQueryData(adminStudentsQuery),
      queryClient.ensureQueryData(adminFamiliesQuery),
    ]);
  },
  component: StudentsPage,
  pendingComponent: () => <div>Loading...</div>,
});

function StudentsPage() {
  const queryClient = useQueryClient();

  const { data: students } = useSuspenseQuery(adminStudentsQuery);
  const { data: families } = useSuspenseQuery(adminFamiliesQuery);

  const [formOpen, setFormOpen] = useState(false);

  const inviteMutation = useMutation({
    mutationFn: async ({ familyId, email }: { familyId: string; email: string }) => {
      const { data, error } = await api.admin.families[familyId].invite.post({ email });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "students"] });
    },
  });

  const openForm = () => setFormOpen(true);
  const closeForm = () => setFormOpen(false);

  const handleInvite = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    inviteMutation.mutate(
      {
        familyId: data.get("family_id") as string,
        email: data.get("email") as string,
      },
      { onSuccess: () => closeForm() },
    );
  };

  return (
    <main data-pwid="students" className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Students</h1>
        <Button onClick={openForm} data-pwid="invite-student">Invite Student</Button>
      </div>

      {students.length === 0 ? (
        <EmptyState message="No students yet." action={{ label: "Invite Student", onClick: openForm }} />
      ) : (
        <div className="flex flex-col gap-3">
          {(students as User[]).map((s) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between">
                <div>
                  <Link to="/students/$id" params={{ id: s.id }} className="font-semibold text-primary no-underline hover:text-accent transition-colors">
                    {s.name}
                  </Link>
                  <span className="text-muted text-sm ml-3">@{s.username}</span>
                  <span className="text-muted/60 text-sm ml-3">{s.email}</span>
                </div>
                <Link to="/students/$id" params={{ id: s.id }} className="text-xs text-muted hover:text-accent no-underline transition-colors">
                  View &rarr;
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={formOpen} onClose={closeForm} title="Invite Student to Family">
        <form onSubmit={handleInvite} data-pwid="invite-form" className="flex flex-col gap-4">
          <Select
            id="invite-family"
            name="family_id"
            label="Family"
            required
            options={(families as Family[]).map((f) => ({ value: f.id, label: f.name }))}
          />
          <Input id="invite-email" name="email" label="Email" type="email" required />
          <div className="flex justify-end gap-3 mt-2">
            <Button variant="ghost" onClick={closeForm}>Cancel</Button>
            <Button type="submit">Send Invite</Button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
