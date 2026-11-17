import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { alphaTabAssets } from "gigbag.js/vite";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    // Serves alphaTab's fonts, sound font and UMD script under /alphatab/, and emits its worker and
    // audio worklet as files, so the worklet is never inlined as a data: URL (which cannot import its core).
    alphaTabAssets(),
    tanstackStart({
      srcDirectory: "app",
    }),
    react(),
    tailwind(),
  ],
});
