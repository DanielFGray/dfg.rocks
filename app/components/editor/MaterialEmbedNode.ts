import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MaterialEmbedView } from "./MaterialEmbedView.js";

export const MaterialEmbedNode = Node.create({
  name: "materialEmbed",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      materialId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-material-id"),
        renderHTML: (attrs) => ({ "data-material-id": attrs.materialId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="material-embed"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "material-embed" }, HTMLAttributes),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MaterialEmbedView);
  },
});
