import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { MaterialEmbedNode } from "./MaterialEmbedNode.js";
import { MaterialsContext } from "./MaterialsContext.js";
import type { Material } from "../../lib/types.js";

export function ModuleContent({ content, materials }: { content: unknown; materials: Material[] }) {
  const materialMap = new Map(materials.map((m) => [m.id, m]));

  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: true }), MaterialEmbedNode],
    content: content ?? undefined,
    editable: false,
  });

  if (!editor) return null;

  return (
    <MaterialsContext.Provider value={materialMap}>
      <EditorContent editor={editor} className="prose dark:prose-invert max-w-none" />
    </MaterialsContext.Provider>
  );
}
