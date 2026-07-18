import type { Editor } from "@tiptap/react";
import { Button } from "../ui/Button.js";
import { Tooltip } from "../ui/Tooltip.js";

export function EditorToolbar({
  editor,
  onEmbedMaterial,
}: {
  editor: Editor;
  onEmbedMaterial: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-t-lg border-b border-overlay/6 bg-overlay/2 px-3 py-2 dark:border-overlay-dark/6 dark:bg-overlay-dark/2">
      <Tooltip content="Bold">
        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          label="B"
          className="font-bold"
        />
      </Tooltip>
      <Tooltip content="Italic">
        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          label="I"
          className="italic"
        />
      </Tooltip>
      <div className="mx-1 h-5 w-px bg-overlay/8 dark:bg-overlay-dark/8" />
      <Tooltip content="Heading 2">
        <ToolbarButton
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          label="H2"
        />
      </Tooltip>
      <Tooltip content="Heading 3">
        <ToolbarButton
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          label="H3"
        />
      </Tooltip>
      <div className="mx-1 h-5 w-px bg-overlay/8 dark:bg-overlay-dark/8" />
      <Tooltip content="Bullet List">
        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          label="List"
        />
      </Tooltip>
      <Tooltip content="Ordered List">
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          label="1."
        />
      </Tooltip>
      <div className="mx-1 h-5 w-px bg-overlay/8 dark:bg-overlay-dark/8" />
      <Tooltip content="Blockquote">
        <ToolbarButton
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          label="Quote"
        />
      </Tooltip>
      <div className="mx-1 h-5 w-px bg-overlay/8 dark:bg-overlay-dark/8" />
      <Button variant="ghost" onClick={onEmbedMaterial} className="px-2.5 py-1 text-xs text-accent">
        + Material
      </Button>
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
  className = "",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded px-2 py-1 text-xs transition-colors ${className} ${
        active
          ? "bg-accent/20 text-accent"
          : "text-muted hover:bg-overlay/5 hover:text-primary dark:text-muted-dark dark:hover:bg-overlay-dark/5 dark:hover:text-primary-dark"
      }`}
    >
      {label}
    </button>
  );
}
