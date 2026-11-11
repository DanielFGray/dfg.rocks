import { Effect } from "effect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { runServerEffect } from "../../lib/serverEffect.js";
import { AuthenticatedRouteService } from "../../../server/services/authenticatedRouteService.js";
import { serializeMaterial } from "../../../shared/responseMappers.js";
import { requireSession } from "../../lib/sessionGuards.server.js";
import {
  StudentAssignmentDetail,
  getAssignedTrackLabel,
} from "../../components/assignments/StudentAssignmentDetail.js";
import { categorize, categoryColor, categoryLabel } from "../../components/library/helpers.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Main } from "../../components/ui/Container.js";

const getAssignmentPageData = createServerFn({ method: "GET" }).handler(() =>
  runServerEffect(
    Effect.gen(function* () {
      const session = yield* requireSession(getCookie("session"));
      const authSvc = yield* AuthenticatedRouteService;
      const assignments = yield* authSvc.assignments(session.session.id);
      return assignments.map(serializeMaterial);
    }),
  ),
);

export const Route = createFileRoute("/_authed/assignments/$materialId")({
  loader: () => getAssignmentPageData(),
  head: () => ({ meta: [{ title: "Assignment | DFG Portal" }] }),
  component: AssignmentDetailPage,
  pendingComponent: () => (
    <main className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 text-muted md:px-8 dark:text-muted-dark">
      Loading...
    </main>
  ),
});

function AssignmentDetailPage() {
  const { materialId } = Route.useParams();
  const data = Route.useLoaderData();

  const material = data.find((entry) => entry.id === materialId) ?? null;

  if (!material) {
    return (
      <Main data-testid="assignment-detail">
        <Link to="/assignments" className="text-sm text-accent hover:underline">
          ← Back to assignments
        </Link>
        <div className="mt-8">
          <EmptyState message="Assignment not found." />
        </div>
      </Main>
    );
  }

  const category = categorize(material.mime_type, material.original_filename);
  const assignedTrackLabel = getAssignedTrackLabel(material);

  return (
    <Main data-testid="assignment-detail">
      <Link to="/assignments" className="text-sm text-accent hover:underline">
        ← Back to assignments
      </Link>

      <div className="mt-4 mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <span
            className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wider uppercase ${categoryColor[category]}`}
          >
            {categoryLabel[category]}
          </span>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">{material.title}</h1>
          <p className="mt-2 text-sm text-muted dark:text-muted-dark">
            {material.original_filename}
            {assignedTrackLabel ? ` · ${assignedTrackLabel}` : ""}
          </p>
        </div>
      </div>

      <StudentAssignmentDetail material={material} initialProgress={null} initialReviews={[]} />
    </Main>
  );
}
