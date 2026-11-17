import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { alphaTab } from "@coderline/alphatab-vite";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    // Bundles alphaTab's worker and audio worklet as chunks beside its core, and copies its
    // font and soundfont into public/ (gitignored) at the start of each build and dev server.
    alphaTab(),
    tanstackStart({
      srcDirectory: "app",
    }),
    react(),
    tailwind(),
  ],
});
