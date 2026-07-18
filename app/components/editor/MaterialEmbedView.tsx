import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useMaterial } from "./MaterialsContext.js";
import { MaterialPreview } from "../library/MaterialPreview.js";

export function MaterialEmbedView({ node }: NodeViewProps) {
  const materialId = node.attrs.materialId;
  const material = useMaterial(materialId);

  return (
    <NodeViewWrapper className="my-4">
      {material ? (
        <div>
          <div className="mb-2 text-sm font-medium text-primary dark:text-primary-dark">
            {material.title}
          </div>
          <MaterialPreview material={material} embedded />
        </div>
      ) : (
        <div className="rounded-lg border border-overlay/6 bg-overlay/5 p-4 text-center text-sm text-muted dark:border-overlay-dark/6 dark:bg-overlay-dark/5 dark:text-muted-dark">
          Material not found
        </div>
      )}
    </NodeViewWrapper>
  );
}
