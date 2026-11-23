import { Effect, Schema as S } from "effect";
import { withAuthContext } from "../../../server/requestDatabase.js";
import { queryOptions, useQuery } from "@tanstack/react-query";
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
import type { AssignedMaterial } from "../../../shared/schemas.js";
import { Main } from "../../components/ui/Container.js";

const getAssignments = createServerFn({ method: "GET" }).handler(() =>
  runServerEffect(
    Effect.gen(function* () {
      const session = yield* Sessions.use((sessions) =>
        sessions.requireSession(getCookie("session")),
      );
      const assignments = yield* Materials.use((materials) =>
        materials.assignments().pipe(withAuthContext(session.session.id)),
      );
      return assignments.map(serializeMaterial);
    }),
  ),
);

/**
 * One track of an assigned score, drawn on the server. The page works without it, because the
 * player draws the music itself, so a failure is logged and gives null. The access check runs
 * as the visitor; the file is read after that transaction.
 */
const getStaticScore = createServerFn({ method: "GET" })
  .validator(S.toStandardSchemaV1(S.Struct({ materialId: S.String, trackIndex: S.Int })))
  .handler(({ data }) =>
    runServerEffect(
      Effect.gen(function* () {
        const session = yield* Sessions.use((sessions) =>
          sessions.requireSession(getCookie("session")),
        );
        const location = yield* Files.use((files) =>
          files.locate(data.materialId).pipe(withAuthContext(session.session.id)),
        );
        return yield* StaticScores.use((scores) => scores.draw(location, data.trackIndex));
      }).pipe(
        Effect.tapError((error) => Effect.logWarning("static score failed", error)),
        Effect.orElseSucceed(() => null),
      ),
    ),
  );

/**
 * A drawing depends only on the file and the track, so it never goes stale. It is a query and
 * not loader data because realtime events rerun the loader, and each rerun would draw again.
 */
const staticScoreQuery = (material: AssignedMaterial) => {
  const trackIndex = material.assigned_track_index ?? 0;
  return queryOptions({
    queryKey: ["static-score", material.id, trackIndex],
    queryFn: () => getStaticScore({ data: { materialId: material.id, trackIndex } }),
    staleTime: Infinity,
    enabled: categorize(material.mime_type, material.original_filename) === "notation",
  });
};

export const Route = createFileRoute("/_authed/assignments/$materialId")({
  loader: async ({ params, context }) => {
    const assignments = await getAssignments();
    const material = assignments.find((entry) => entry.id === params.materialId);
    const scoreQuery = material && staticScoreQuery(material);
    if (scoreQuery?.enabled) await context.queryClient.ensureQueryData(scoreQuery);
    return { assignments };
  },
  head: () => ({ meta: [{ title: "Assignment | DFG Portal" }] }),
  component: AssignmentDetailPage,
  pendingComponent: () => (
    <main className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 text-muted md:px-8">
      Loading...
    </main>
  ),
});

function AssignmentDetailPage() {
  const { materialId } = Route.useParams();
  const { assignments } = Route.useLoaderData();
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

  return <AssignmentDetail material={material} />;
}

function AssignmentDetail({ material }: { material: AssignedMaterial }) {
  const { data: staticScore = null } = useQuery(staticScoreQuery(material));
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
          <p className="mt-2 text-sm text-muted">
            {material.original_filename}
            {assignedTrackLabel ? ` · ${assignedTrackLabel}` : ""}
          </p>
        </div>
      </div>

      <StudentAssignmentDetail key={material.id} material={material} staticScore={staticScore} />
    </Main>
  );
}
