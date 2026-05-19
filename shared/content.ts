import { isTipTapNode, type TipTapNode } from "./tiptap.js";

function collectMaterialIds(node: TipTapNode, seen: Set<string>, output: string[]): void {
  if (node.type === "materialEmbed" && node.attrs && typeof node.attrs.materialId === "string") {
    const materialId = node.attrs.materialId;
    if (!seen.has(materialId)) {
      seen.add(materialId);
      output.push(materialId);
    }
  }

  if (!Array.isArray(node.content)) {
    return;
  }

  for (const child of node.content) {
    if (isTipTapNode(child)) {
      collectMaterialIds(child, seen, output);
    }
  }
}

export function extractMaterialIds(content: unknown): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  if (isTipTapNode(content)) {
    collectMaterialIds(content, seen, output);
    return output;
  }

  if (Array.isArray(content)) {
    for (const value of content) {
      if (isTipTapNode(value)) {
        collectMaterialIds(value, seen, output);
      }
    }
  }

  return output;
}
