import { useState } from "react";
import { Effect } from "effect";
import * as Result from "effect/Result";
import * as S from "effect/Schema";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { api } from "../../lib/api.js";
import { getErrorMessage } from "../../lib/errors.js";
import { runServerEffect } from "../../lib/serverEffect.js";
import { AuthenticatedRouteService } from "../../../server/services/authenticatedRouteService.js";
import type {
  CourseDetail,
  Material,
  ModuleWithMaterials,
  RichTextDocument,
} from "../../../shared/schemas.js";
import {
  serializeCourseDetail,
  serializeLibraryMaterial,
} from "../../../shared/responseMappers.js";
import { requireSession } from "../../lib/sessionGuards.server.js";
import { Input } from "../../components/ui/Input.js";
import { Button } from "../../components/ui/Button.js";
import { ModuleEditor } from "../../components/editor/ModuleEditor.js";

type ModuleEditPageData = {
  course: CourseDetail & { modules: readonly ModuleWithMaterials[] };
  allMaterials: readonly Material[];
};

const getModuleEditPageData = createServerFn({ method: "GET" })
  .validator(S.toStandardSchemaV1(S.Struct({ courseId: S.String })))
  .handler(({ data }) =>
    runServerEffect(
      Effect.gen(function* () {
        const session = yield* requireSession(getCookie("session"));
        const [course, allMaterials] = yield* Effect.all([
          AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.courseById(session.session.id, data.courseId),
          ),
          AuthenticatedRouteService.use((authenticatedRouteService) =>
            authenticatedRouteService.library(session.session.id, { limit: 1000, offset: 0 }),
          ),
        ]);
        return {
          course: serializeCourseDetail(course),
          allMaterials: allMaterials.map(serializeLibraryMaterial),
        } satisfies ModuleEditPageData;
      }),
    ),
  );

export const Route = createFileRoute("/_authed/courses/$courseId/modules/$moduleId/edit")({
  head: () => ({ meta: [{ title: "Edit Module | DFG Portal" }] }),
  loader: ({ params }) => getModuleEditPageData({ data: { courseId: params.courseId } }),
  component: ModuleEditPage,
  pendingComponent: () => (
    <div className="pt-20 text-center text-muted dark:text-muted-dark">Loading...</div>
  ),
});

function ModuleEditPage() {
  const { courseId, moduleId } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { course, allMaterials } = Route.useLoaderData();

  const mod = course.modules.find((m: ModuleWithMaterials) => m.id === moduleId);

  if (!mod) {
    return (
      <main className="mx-auto max-w-225 px-3 pt-20 pb-16 md:px-8">
        <div className="mb-6">
          <Link
            to="/courses/$id"
            params={{ id: courseId }}
            className="text-sm text-muted no-underline transition-colors hover:text-primary dark:text-muted-dark dark:hover:text-primary-dark"
          >
            &larr; Back to Course
          </Link>
        </div>
        <p className="text-center text-muted dark:text-muted-dark">Module not found.</p>
      </main>
    );
  }

  const [title, setTitle] = useState(mod.title);
  const [content, setContent] = useState<Result.Result<RichTextDocument | null, S.SchemaError>>(
    Result.succeed(mod.content ?? null),
  );
  const [dirty, setDirty] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (doc: RichTextDocument | null) =>
      Effect.runPromise(
        api.coursesAdmin.updateModule({
          params: { id: moduleId },
          payload: { title, content: doc },
        }),
      ),
    onSuccess: () => {
      void router.invalidate();
      void queryClient.invalidateQueries({ queryKey: ["courses", courseId] });
      navigate({ to: "/courses/$id", params: { id: courseId } });
    },
  });

  const handleContentChange = (doc: Result.Result<RichTextDocument, S.SchemaError>) => {
    setContent(doc);
    setDirty(true);
  };

  return (
    <main className="mx-auto max-w-[900px] px-3 pt-20 pb-16 md:px-8">
      <div className="mb-6">
        <Link
          to="/courses/$id"
          params={{ id: courseId }}
          className="text-sm text-muted no-underline transition-colors hover:text-primary dark:text-muted-dark dark:hover:text-primary-dark"
        >
          &larr; Back to Course
        </Link>
      </div>

      <div className="flex flex-col gap-6">
        <Input
          id="module-title"
          name="title"
          label="Module Title"
          value={title}
          onChange={(v) => {
            setTitle(v);
            setDirty(true);
          }}
        />

        <div>
          <label className="mb-2 block text-sm font-medium text-primary dark:text-primary-dark">
            Content
          </label>
          <ModuleEditor
            content={mod.content ?? null}
            onChange={handleContentChange}
            allMaterials={[...allMaterials]}
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link to="/courses/$id" params={{ id: courseId }} className="no-underline">
            <Button variant="ghost">Cancel</Button>
          </Link>
          <Button
            variant="primary"
            disabled={!dirty || saveMutation.isPending || Result.isFailure(content)}
            onClick={() => {
              if (Result.isSuccess(content)) saveMutation.mutate(content.success);
            }}
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>

        {Result.isFailure(content) ? (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
          >
            This content cannot be saved: {content.failure.message}
          </div>
        ) : null}

        {saveMutation.isError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
          >
            {getErrorMessage(saveMutation.error, "Failed to save")}
          </div>
        ) : null}
      </div>
    </main>
  );
}
