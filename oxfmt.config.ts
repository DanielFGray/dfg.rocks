import { defineConfig } from "oxfmt";

export default defineConfig({
  sortTailwindcss: {
    stylesheet: "./app/styles.css",
    functions: ["classed"],
    preserveWhitespace: true,
  },
});
