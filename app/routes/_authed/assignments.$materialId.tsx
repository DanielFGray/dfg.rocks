import { Effect, Schema as S } from "effect";
import { withAuthContext } from "../../../server/requestDatabase.js";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { runServerEffect } from "../../lib/serverEffect.js";
import { Materials } from "../../../server/services/materials.js";
import { serializeMaterial } from "../../../shared/responseMappers.js";
import { Sessions } from "../../../server/services/sessions.js";
import { Files } from "../../../server/services/files.js";
import { StaticScores } from "../../../server/services/staticScores.js";
import {
  StudentAssignmentDetail,
  getAssignedTrackLabel,
} from "../../components/assignments/StudentAssignmentDetail.js";
import { categorize, categoryColor, categoryLabel } from "../../components/library/helpers.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { Main } from "../../components/ui/Container.js";

const getAssignmentPageData = createServerFn({ method: "GET" })
  .validator(S.toStandardSchemaV1(S.Struct({ materialId: S.String })))
  .handler(({ data }) =>
    runServerEffect(
      Effect.gen(function* () {
        const session = yield* Sessions.use((sessions) =>
          sessions.requireSession(getCookie("session")),
        );
        const sessionId = session.session.id;
        const assignments = yield* Materials.use((materials) =>
          materials.assignments().pipe(withAuthContext(sessionId)),
        );
        const materials = assignments.map(serializeMaterial);
        const material = materials.find((entry) => entry.id === data.materialId);
        const staticScore =
          material && categorize(material.mime_type, material.original_filename) === "notation"
            ? yield* drawStaticScore(material.id, material.assigned_track_index ?? 0, sessionId)
            : null;
        return { assignments: materials, staticScore };
      }),
    ),
  );

/**
 * The assigned track drawn on the server. The page works without it, because the player
 * draws the music itself, so a failure is logged and gives null. The access check runs as
 * the visitor; the file is read after that transaction.
 */
const drawStaticScore = (materialId: string, trackIndex: number, sessionId: string) =>
  Effect.gen(function* () {
    const location = yield* Files.use((files) =>
      files.locate(materialId).pipe(withAuthContext(sessionId)),
    );
    return yield* StaticScores.use((scores) => scores.draw(location, trackIndex));
  }).pipe(
    Effect.tapError((error) => Effect.logWarning("static score failed", error)),
    Effect.orElseSucceed(() => null),
  );

export const Route = createFileRoute("/_authed/assignments/$materialId")({
  loader: ({ params }) => getAssignmentPageData({ data: { materialId: params.materialId } }),
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
  const { assignments, staticScore } = Route.useLoaderData();

  const material = assignments.find((entry) => entry.id === materialId) ?? null;

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

      <StudentAssignmentDetail
        material={material}
        staticScore={staticScore}
        initialProgress={null}
        initialReviews={[]}
      />
    </Main>
  );
}
