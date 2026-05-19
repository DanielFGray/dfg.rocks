import { useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { getModuleEditPageData } from "../../lib/routeData.js";
import { Input } from "../../components/ui/Input.js";
import { Button } from "../../components/ui/Button.js";
import { ModuleEditor } from "../../components/editor/ModuleEditor.js";

export const Route = createFileRoute("/_authed/courses/$courseId/modules/$moduleId/edit")({
  head: () => ({ meta: [{ title: "Edit Module | DFG Portal" }] }),
  loader: ({ params: { moduleId } }) => getModuleEditPageData({ data: { moduleId } }),
  component: ModuleEditPage,
  pendingComponent: () => (
    <div className="pt-20 text-muted dark:text-muted-dark text-center">Loading...</div>
  ),
});

function ModuleEditPage() {
  const { courseId, moduleId } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const { mod, allMaterials } = Route.useLoaderData();

  const [title, setTitle] = useState(mod.title);
  const [content, setContent] = useState<unknown>(mod.content);
  const [dirty, setDirty] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.admin.modules({ id: moduleId }).patch({
        title,
        content: content ?? null,
      });
      if (error) throw error;
      if ("error" in data) throw data.error;
      return data;
    },
    onSuccess: () => {
      void router.invalidate();
      navigate({ to: "/courses/$id", params: { id: courseId } });
    },
  });

  const handleContentChange = (json: unknown) => {
    setContent(json);
    setDirty(true);
  };

  return (
    <main className="px-3 md:px-8 pt-20 pb-16 mx-auto max-w-[900px]">
      <div className="mb-6">
        <Link
          to="/courses/$id"
          params={{ id: courseId }}
          className="text-muted dark:text-muted-dark text-sm hover:text-primary dark:hover:text-primary-dark no-underline transition-colors"
        >
          &larr; Back to Course
        </Link>
      </div>

      <div className="gap-6 flex flex-col">
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
          <label className="text-sm font-medium text-primary dark:text-primary-dark mb-2 block">
            Content
          </label>
          <ModuleEditor
            content={content}
            onChange={handleContentChange}
            allMaterials={allMaterials ?? []}
          />
        </div>

        <div className="gap-3 pt-2 flex items-center justify-end">
          <Link to="/courses/$id" params={{ id: courseId }} className="no-underline">
            <Button variant="ghost">Cancel</Button>
          </Link>
          <Button
            variant="primary"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>

        {saveMutation.isError ? (
          <div
            role="alert"
            className="rounded-lg border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400 border"
          >
            {saveMutation.error.message}
          </div>
        ) : null}
      </div>
    </main>
  );
}
