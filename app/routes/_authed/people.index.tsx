import { useState, useMemo } from "react";
import { Effect, Schema as S } from "effect";
import { withAuthContext } from "../../../server/requestDatabase.js";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { requireStaff } from "../../lib/adminRoute.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { useForm } from "@tanstack/react-form";
import { api } from "../../lib/api.js";
import { requiredValidator, emailValidator } from "../../lib/validators.js";
import { fieldError } from "../../lib/form.js";
import { runServerEffect } from "../../lib/serverEffect.js";
import { People } from "../../../server/services/people.js";
import { Families } from "../../../server/services/families.js";
import { serializeFamily } from "../../../shared/responseMappers.js";
import { Sessions } from "../../../server/services/sessions.js";
import { FamilyInviteRole, type Family, type PersonSummary } from "../../../shared/schemas.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Input } from "../../components/ui/Input.js";
import { Select } from "../../components/ui/Select.js";
import { Modal } from "../../components/ui/Modal.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { SearchField } from "../../components/ui/SearchField.js";
import { QrInviteModal } from "../../components/students/QrInviteModal.js";
import { CreateFamilyModal } from "../../components/students/CreateFamilyModal.js";

type PeoplePageData = {
  people: readonly PersonSummary[];
  families: Family[];
};

const getPeoplePageData = createServerFn({ method: "GET" }).handler(() =>
  runServerEffect(
    Effect.gen(function* () {
      const session = yield* Sessions.use((sessions) =>
        sessions.requireStaffSession(getCookie("session")),
      );
      const [people, families] = yield* Effect.all([
        People.use((people) => people.listPeople()),
        Families.use((familyService) => familyService.listFamilies()),
      ]).pipe(withAuthContext(session.session.id));
      return {
        people,
        families: families.map(serializeFamily),
      } satisfies PeoplePageData;
    }),
  ),
);

/* ---------------------------------------------------------------------------
 * Route
 * --------------------------------------------------------------------------- */

export const Route = createFileRoute("/_authed/people/")({
  beforeLoad: requireStaff,
  head: () => ({ meta: [{ title: "People | DFG Portal" }] }),
  loader: () => getPeoplePageData(),
  component: PeoplePage,
  pendingComponent: () => <div>Loading...</div>,
});

const ROLE_FILTER_OPTIONS = [
  { value: "all", label: "All roles" },
  { value: "student", label: "Students" },
  { value: "parent", label: "Parents" },
  { value: "teacher", label: "Teachers" },
  { value: "admin", label: "Admins" },
];

function PeoplePage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { people, families } = Route.useLoaderData();
  const { isAdmin } = useAuth();

  const [formOpen, setFormOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [createFamilyOpen, setCreateFamilyOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const filteredPeople = useMemo(
    () =>
      people.filter(
        (p) =>
          (roleFilter === "all" || p.role === roleFilter) &&
          (!searchQuery ||
            (p.name ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.email ?? "").toLowerCase().includes(searchQuery.toLowerCase())),
      ),
    [people, searchQuery, roleFilter],
  );

  const inviteMutation = useMutation({
    mutationFn: async ({
      familyId,
      email,
      invitedRole,
    }: {
      familyId: string;
      email: string;
      invitedRole: FamilyInviteRole;
    }) =>
      Effect.runPromise(
        api.familiesAdmin.inviteFamily({
          params: { familyId },
          payload: { email, invited_role: invitedRole },
        }),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "people"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "families"] });
      void router.invalidate();
    },
  });

  const createFamilyMutation = useMutation({
    mutationFn: (payload: { slug: string; name: string }) =>
      Effect.runPromise(api.familiesAdmin.createFamily({ payload })),
    onSettled: () => {
      setCreateFamilyOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "families"] });
      void router.invalidate();
    },
  });

  const openForm = () => setFormOpen(true);
  const closeForm = () => {
    setFormOpen(false);
    inviteForm.reset();
  };

  const inviteForm = useForm({
    defaultValues: {
      familyId: families[0]?.id ?? "",
      email: "",
      invitedRole: "parent",
    },
    onSubmit: async ({ value }) => {
      inviteMutation.mutate(
        {
          familyId: value.familyId,
          email: value.email,
          invitedRole: S.decodeUnknownSync(FamilyInviteRole)(value.invitedRole),
        },
        {
          onSuccess: () => closeForm(),
        },
      );
    },
  });

  return (
    <main data-testid="people" className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 md:px-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">People</h1>
        {isAdmin ? (
          <div className="flex gap-3">
            <Button
              variant="ghost"
              onClick={() => setCreateFamilyOpen(true)}
              data-testid="create-family-btn"
            >
              Create Family
            </Button>
            <Button variant="ghost" onClick={() => setQrOpen(true)} data-testid="add-via-qr">
              Add via QR
            </Button>
            <Button onClick={openForm} data-testid="invite-student">
              Invite Student
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mb-6 flex flex-col gap-3 md:flex-row">
        <div className="flex-1">
          <SearchField
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by name, username, or email..."
            data-testid="people-search"
          />
        </div>
        <div className="md:w-48">
          <Select
            id="people-role-filter"
            name="role"
            label="Role"
            value={roleFilter}
            onChange={setRoleFilter}
            options={ROLE_FILTER_OPTIONS}
          />
        </div>
      </div>

      {filteredPeople.length === 0 ? (
        <EmptyState
          message={
            searchQuery || roleFilter !== "all" ? "No people match your search." : "No people yet."
          }
          action={
            searchQuery || roleFilter !== "all" || !isAdmin
              ? undefined
              : { label: "Invite Student", onClick: openForm }
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filteredPeople.map((p) => (
            <Card key={p.id}>
              <div className="flex items-center justify-between">
                <div>
                  <Link
                    to="/people/$id"
                    params={{ id: p.id }}
                    className="font-semibold text-primary no-underline transition-colors hover:text-accent dark:text-primary-dark"
                  >
                    {p.name ?? p.username}
                  </Link>
                  <span className="ml-3 text-sm text-muted dark:text-muted-dark">
                    @{p.username}
                  </span>
                  <span className="ml-3 text-sm text-muted/60 dark:text-muted-dark/60">
                    {p.email}
                  </span>
                  <span className="ml-3 text-xs tracking-wide text-muted uppercase dark:text-muted-dark">
                    {p.role}
                  </span>
                </div>
                <Link
                  to="/people/$id"
                  params={{ id: p.id }}
                  className="text-xs text-muted no-underline transition-colors hover:text-accent dark:text-muted-dark"
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
          className="flex flex-col gap-4"
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
          <inviteForm.Field name="invitedRole">
            {(field) => (
              <Select
                id="invite-role"
                name="invited_role"
                label="Role"
                value={field.state.value}
                onChange={field.handleChange}
                options={[
                  { value: "parent", label: "Parent" },
                  { value: "student", label: "Student" },
                ]}
                error={fieldError(field.state.meta.errors)}
              />
            )}
          </inviteForm.Field>
          <div className="mt-2 flex justify-end gap-3">
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
        families={[...families]}
        onSuccess={() => {
          void queryClient.invalidateQueries({
            queryKey: ["admin", "people"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["admin", "families"],
          });
          void router.invalidate();
        }}
      />

      <CreateFamilyModal
        open={createFamilyOpen}
        onClose={() => setCreateFamilyOpen(false)}
        onSubmit={(value) => createFamilyMutation.mutate(value)}
      />
    </main>
  );
}
