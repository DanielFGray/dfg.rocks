import type { RichTextDocument, RichTextNode } from "./schemas.js";

/** Ids of the materials embedded in a module document, in document order, without repeats. */
export function extractMaterialIds(doc: RichTextDocument): string[] {
  const ids = new Set<string>();
  const walk = (node: RichTextNode) => {
    const materialId = node.attrs?.materialId;
    if (node.type === "materialEmbed" && typeof materialId === "string") ids.add(materialId);
    node.content?.forEach(walk);
  };
  doc.content?.forEach(walk);
  return [...ids];
}
