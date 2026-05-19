import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { MaterialEmbedNode } from "./MaterialEmbedNode.js";
import { MaterialsContext } from "./MaterialsContext.js";
import { EditorToolbar } from "./EditorToolbar.js";
import { AttachMaterialModal } from "../courses/AttachMaterialModal.js";
import type { Material } from "../../lib/types.js";
import { isTipTapNode } from "../../../shared/tiptap.js";

export function ModuleEditor({
  content,
  onChange,
  allMaterials,
}: {
  content: unknown;
  onChange: (json: unknown) => void;
  allMaterials: Material[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const materialMap = new Map(allMaterials.map((m) => [m.id, m]));

  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false }), MaterialEmbedNode],
    content: content ?? undefined,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON());
    },
  });

  if (!editor) return null;

  // Compute which materials are already embedded
  const embeddedIds = new Set<string>();
  editor.getJSON().content?.forEach(function walk(node: unknown) {
    if (!isTipTapNode(node)) return;

    if (node.type === "materialEmbed" && node.attrs && typeof node.attrs.materialId === "string") {
      embeddedIds.add(node.attrs.materialId);
    }
    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
    }
  });
  const availableMaterials = allMaterials.filter((m) => !embeddedIds.has(m.id));

  const handleAttach = (materialId: string) => {
    editor.chain().focus().insertContent({ type: "materialEmbed", attrs: { materialId } }).run();
    setPickerOpen(false);
  };

  return (
    <MaterialsContext.Provider value={materialMap}>
      <div className="rounded-lg border-overlay/6 bg-card dark:border-overlay-dark/6 dark:bg-card-dark border">
        <EditorToolbar editor={editor} onEmbedMaterial={() => setPickerOpen(true)} />
        <EditorContent
          editor={editor}
          className="prose px-5 py-4 dark:prose-invert [&_.ProseMirror_p.is-editor-empty:first-child]:before:h-0 [&_.ProseMirror_p.is-editor-empty:first-child]:before:text-muted dark:[&_.ProseMirror_p.is-editor-empty:first-child]:before:text-muted-dark max-w-none [&_.ProseMirror]:min-h-[300px] [&_.ProseMirror]:outline-hidden [&_.ProseMirror_p.is-editor-empty:first-child]:before:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child]:before:float-left [&_.ProseMirror_p.is-editor-empty:first-child]:before:content-['Start_writing...']"
        />
      </div>
      <AttachMaterialModal
        open={pickerOpen}
        title="Embed Material"
        availableMaterials={availableMaterials}
        allMaterialsCount={allMaterials.length}
        onClose={() => setPickerOpen(false)}
        onAttach={handleAttach}
      />
    </MaterialsContext.Provider>
  );
}
