import { lazy, Suspense } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

const AlphaTabPlayer = lazy(() =>
  import("../alphatab/AlphaTabPlayer.js").then((m) => ({ default: m.AlphaTabPlayer })),
);

/** The score player; in an editable editor, the alphaTex source beneath it for editing. */
export function AlphaTexView({ node, editor, updateAttributes }: NodeViewProps) {
  const tex = String(node.attrs.tex ?? "");

  return (
    <NodeViewWrapper className="my-4" data-testid="alpha-tex-node">
      <Suspense
        fallback={
          <div className="p-6 text-center text-sm text-muted dark:text-muted-dark">Loading...</div>
        }
      >
        {tex.trim() ? (
          <AlphaTabPlayer source={{ tex }} />
        ) : (
          <p className="text-sm text-muted dark:text-muted-dark">Write the score below.</p>
        )}
      </Suspense>
      {editor.isEditable ? (
        <textarea
          aria-label="alphaTex source"
          value={tex}
          onChange={(event) => updateAttributes({ tex: event.target.value })}
          rows={8}
          spellCheck={false}
          className="mt-2 w-full rounded-sm border border-overlay/10 bg-card p-2 font-mono text-xs dark:border-overlay-dark/10 dark:bg-card-dark"
        />
      ) : null}
    </NodeViewWrapper>
  );
}
