import type { Editor } from "@tiptap/react";
import { Button } from "../ui/Button.js";

export function EditorToolbar({
  editor,
  onEmbedMaterial,
}: {
  editor: Editor;
  onEmbedMaterial: () => void;
}) {
  return (
    <div className="gap-1 border-overlay/6 dark:border-overlay-dark/6 bg-overlay/2 dark:bg-overlay-dark/2 px-3 py-2 rounded-t-lg flex flex-wrap items-center border-b">
      <ToolbarButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label="B"
        title="Bold"
        className="font-bold"
      />
      <ToolbarButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label="I"
        title="Italic"
        className="italic"
      />
      <div className="h-5 bg-overlay/8 dark:bg-overlay-dark/8 mx-1 w-px" />
      <ToolbarButton
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        label="H2"
        title="Heading 2"
      />
      <ToolbarButton
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        label="H3"
        title="Heading 3"
      />
      <div className="h-5 bg-overlay/8 dark:bg-overlay-dark/8 mx-1 w-px" />
      <ToolbarButton
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        label="List"
        title="Bullet List"
      />
      <ToolbarButton
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        label="1."
        title="Ordered List"
      />
      <div className="h-5 bg-overlay/8 dark:bg-overlay-dark/8 mx-1 w-px" />
      <ToolbarButton
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        label="Quote"
        title="Blockquote"
      />
      <div className="h-5 bg-overlay/8 dark:bg-overlay-dark/8 mx-1 w-px" />
      <Button
        variant="ghost"
        onClick={onEmbedMaterial}
        className="text-xs px-2.5 py-1 text-accent"
      >
        + Material
      </Button>
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
  title,
  className = "",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2 py-1 rounded text-xs cursor-pointer transition-colors ${className} ${
        active
          ? "bg-accent/20 text-accent"
          : "text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark hover:bg-overlay/5 dark:hover:bg-overlay-dark/5"
      }`}
    >
      {label}
    </button>
  );
}
