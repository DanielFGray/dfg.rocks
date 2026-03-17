import * as Effect from "effect/Effect";
import { Atom, AtomRegistry, Suspense } from "fibrae";
import { Link, NavigatorTag } from "fibrae/router";
import { DfgApi, type User } from "./api.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Modal } from "../ui/modal.js";
import { EmptyState } from "../ui/empty_state.js";

const studentFormOpen = Atom.make(false);

function StudentList() {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const api = yield* DfgApi;
    const students = yield* api.admin.students({});
    const formOpen = registry.get(studentFormOpen);

    const openForm = () => {
      registry.set(studentFormOpen, true);
    };

    const closeForm = () => {
      registry.set(studentFormOpen, false);
    };

    const handleCreate = (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const data = new FormData(form);
      return Effect.gen(function* () {
        const api = yield* DfgApi;
        yield* api.admin.createStudent({ payload: {
          username: data.get("username") as string,
          name: data.get("name") as string,
          email: data.get("email") as string,
        } });
        const reg = yield* AtomRegistry.AtomRegistry;
        reg.set(studentFormOpen, false);
        const navigator = yield* NavigatorTag;
        yield* navigator.go("/students");
      });
    };

    return (
      <div>
        <div class="flex items-center justify-between mb-8">
          <h1 class="text-3xl font-bold tracking-tight">Students</h1>
          <Button onclick={openForm} data-cy="new-student">New Student</Button>
        </div>

        {students.length === 0 ? (
          <EmptyState message="No students yet." action={{ label: "Create Student", onclick: openForm }} />
        ) : (
          <div class="flex flex-col gap-3">
            {(students as User[]).map((s) => (
              <Card>
                <div class="flex items-center justify-between">
                  <div>
                    <Link href={`/students/${s.id}`} class="font-semibold text-primary no-underline hover:text-accent transition-colors">
                      {s.name}
                    </Link>
                    <span class="text-muted text-sm ml-3">@{s.username}</span>
                    <span class="text-muted/60 text-sm ml-3">{s.email}</span>
                  </div>
                  <Link href={`/students/${s.id}`} class="text-xs text-muted hover:text-accent no-underline transition-colors">
                    View &rarr;
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}

        <Modal open={formOpen} onclose={closeForm} title="New Student">
          <form onsubmit={handleCreate} data-cy="student-form" class="flex flex-col gap-4">
            <Input id="student-name" name="name" label="Full Name" required />
            <Input id="student-username" name="username" label="Username" required />
            <Input id="student-email" name="email" label="Email" type="email" required />
            <div class="flex justify-end gap-3 mt-2">
              <Button variant="ghost" onclick={closeForm}>Cancel</Button>
              <Button type="submit">Create</Button>
            </div>
          </form>
        </Modal>
      </div>
    );
  });
}

export const StudentsPage = () => (
  <main data-cy="students" class="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16">
    <Suspense fallback={<p class="text-muted">Loading students...</p>} threshold={50}>
      <StudentList />
    </Suspense>
  </main>
);
