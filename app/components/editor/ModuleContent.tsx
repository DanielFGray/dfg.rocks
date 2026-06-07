import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { MaterialEmbedNode } from "./MaterialEmbedNode.js";
import { MaterialsContext } from "./MaterialsContext.js";
import type { Material } from "../../../shared/schemas.js";

export function ModuleContent({
  content,
  materials,
}: {
  content: unknown;
  materials: readonly Material[];
}) {
  const materialMap = new Map(materials.map((m) => [m.id, m]));

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: true }),
      MaterialEmbedNode,
    ],
    content: content ?? undefined,
    editable: false,
  });

  if (!editor) return null;

  return (
    <MaterialsContext.Provider value={materialMap}>
      <EditorContent
        editor={editor}
        className="prose max-w-none dark:prose-invert"
      />
    </MaterialsContext.Provider>
  );
}
