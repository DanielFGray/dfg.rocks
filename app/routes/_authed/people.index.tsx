import { useState, useMemo } from "react";
import { Effect } from "effect";
import { withAuthContext } from "../../../server/requestDatabase.js";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { requireStaff } from "../../lib/adminRoute.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { api } from "../../lib/api.js";
import { runServerEffect } from "../../lib/serverEffect.js";
import { People } from "../../../server/services/people.js";
import { Families } from "../../../server/services/families.js";
import { Invitations } from "../../../server/services/invitations.js";
import type { PendingInvitation } from "../../../shared/api/invitations.js";
import { serializeFamily } from "../../../shared/responseMappers.js";
import { Sessions } from "../../../server/services/sessions.js";
import type { Family, PersonSummary } from "../../../shared/schemas.js";
import { Button } from "../../components/ui/Button.js";
import { Card } from "../../components/ui/Card.js";
import { Select } from "../../components/ui/Select.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { SearchField } from "../../components/ui/SearchField.js";
import { QrInviteModal } from "../../components/students/QrInviteModal.js";
import { InviteAccountModal } from "../../components/students/InviteAccountModal.js";
import { PendingInvitations } from "../../components/students/PendingInvitations.js";
import { CreateFamilyModal } from "../../components/students/CreateFamilyModal.js";

type PeoplePageData = {
  people: readonly PersonSummary[];
  families: Family[];
  pendingInvitations: readonly PendingInvitation[];
};

const getPeoplePageData = createServerFn({ method: "GET" }).handler(() =>
  runServerEffect(
    Effect.gen(function* () {
      const session = yield* Sessions.use((sessions) =>
        sessions.requireStaffSession(getCookie("session")),
      );
      const [people, families, pendingInvitations] = yield* Effect.all([
        People.use((people) => people.listPeople()),
        Families.use((familyService) => familyService.listFamilies()),
        Invitations.use((invitations) => invitations.pendingInvitations()),
      ]).pipe(withAuthContext(session.session.id));
      return {
        people,
        families: families.map(serializeFamily),
        pendingInvitations,
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
  const { people, families, pendingInvitations } = Route.useLoaderData();
  const { isAdmin } = useAuth();

  const [formOpen, setFormOpen] = useState(false);
  const [invited, setInvited] = useState<string | null>(null);
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
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "people"] });
    void router.invalidate();
  };

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

      {invited ? (
        <p
          data-testid="invite-sent"
          role="status"
          className="mb-6 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200"
        >
          Invitation sent to {invited}. Their account is ready for lessons now.
        </p>
      ) : null}

      <PendingInvitations invitations={pendingInvitations} onResent={refresh} />

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
                    className="font-semibold text-primary no-underline transition-colors hover:text-accent"
                  >
                    {p.name ?? p.username}
                  </Link>
                  <span className="ml-3 text-sm text-muted">
                    @{p.username}
                  </span>
                  <span className="ml-3 text-sm text-muted/60">
                    {p.email}
                  </span>
                  <span className="ml-3 text-xs tracking-wide text-muted uppercase">
                    {p.role}
                  </span>
                </div>
                <Link
                  to="/people/$id"
                  params={{ id: p.id }}
                  className="text-xs text-muted no-underline transition-colors hover:text-accent"
                >
                  View &rarr;
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      <InviteAccountModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        families={families}
        onInvited={(person) => {
          setInvited(person.name ?? person.username);
          refresh();
        }}
      />

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
