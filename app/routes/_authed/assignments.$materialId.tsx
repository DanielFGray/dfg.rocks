import { createFileRoute, Link } from "@tanstack/react-router";
import { getAssignmentsPageData } from "../../lib/routeData.js";
import {
  StudentAssignmentDetail,
  getAssignedTrackLabel,
} from "../../components/assignments/StudentAssignmentDetail.js";
import { categorize, categoryColor, categoryLabel } from "../../components/library/helpers.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

export const Route = createFileRoute("/_authed/assignments/$materialId")({
  loader: () => getAssignmentsPageData(),
  head: () => ({ meta: [{ title: "Assignment | DFG Portal" }] }),
  component: AssignmentDetailPage,
  pendingComponent: () => (
    <main className="px-5 pb-16 pt-20 text-muted md:px-8 dark:text-muted-dark mx-auto max-w-[1100px]">
      Loading...
    </main>
  ),
});

function AssignmentDetailPage() {
  const { materialId } = Route.useParams();
  const data = Route.useLoaderData();

  if (data.kind === "staff") {
    return (
      <main
        data-testid="assignment-detail"
        className="px-5 pb-16 pt-20 md:px-8 mx-auto max-w-[1100px]"
      >
        <Link to="/assignments" className="text-sm text-accent hover:underline">
          ← Back to assignments
        </Link>
        <div className="mt-8">
          <EmptyState message="Assignment detail is available from the student portal." />
        </div>
      </main>
    );
  }

  const material = data.materials.find((entry) => entry.id === materialId) ?? null;

  if (!material) {
    return (
      <main
        data-testid="assignment-detail"
        className="px-5 pb-16 pt-20 md:px-8 mx-auto max-w-[1100px]"
      >
        <Link to="/assignments" className="text-sm text-accent hover:underline">
          ← Back to assignments
        </Link>
        <div className="mt-8">
          <EmptyState message="Assignment not found." />
        </div>
      </main>
    );
  }

  const category = categorize(material.mime_type, material.original_filename);
  const assignedTrackLabel = getAssignedTrackLabel(material);
  const progress = data.progress.find((entry) => entry.material_id === material.id) ?? null;
  const reviews = data.reviews.filter((entry) => entry.material_id === material.id);

  return (
    <main
      data-testid="assignment-detail"
      className="px-5 pb-16 pt-20 md:px-8 mx-auto max-w-[1100px]"
    >
      <Link to="/assignments" className="text-sm text-accent hover:underline">
        ← Back to assignments
      </Link>

      <div className="mb-6 mt-4 gap-4 md:flex-row md:items-start md:justify-between flex flex-col">
        <div className="min-w-0">
          <span
            className={`rounded-md px-2 py-0.5 font-semibold tracking-wider inline-flex text-[11px] uppercase ${categoryColor[category]}`}
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

      <StudentAssignmentDetail
        material={material}
        initialProgress={progress}
        initialReviews={reviews}
      />
    </main>
  );
}
