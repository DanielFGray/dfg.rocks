import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { AlphaTexView } from "./AlphaTexView.js";

/**
 * A score written inline as alphaTex source. gigbag.js draws and plays it, so the score needs no
 * file in object storage, unlike a materialEmbed.
 */
export const AlphaTexNode = Node.create({
  name: "alphaTex",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      tex: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-tex") ?? "",
        renderHTML: (attrs) => ({ "data-tex": attrs.tex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="alpha-tex"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-type": "alpha-tex" }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AlphaTexView);
  },
});
