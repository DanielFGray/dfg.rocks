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
          <div className="text-sm font-medium text-primary dark:text-primary-dark mb-2">
            {material.title}
          </div>
          <MaterialPreview material={material} embedded />
        </div>
      ) : (
        <div className="rounded-lg border-overlay/6 dark:border-overlay-dark/6 bg-overlay/5 dark:bg-overlay-dark/5 p-4 text-sm text-muted dark:text-muted-dark border text-center">
          Material not found
        </div>
      )}
    </NodeViewWrapper>
  );
}
