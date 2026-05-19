import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { alphaTabAssetsPlugin } from "./scripts/alphaTabAssetsPlugin.js";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    alphaTabAssetsPlugin(),
    tanstackStart({ srcDirectory: "app" }),
    react(),
    tailwind(),
  ],
  optimizeDeps: {
    exclude: ["@coderline/alphatab"],
  },
  server: {
    host: process.env.HOST || "localhost",
    port: parseInt(process.env.VITE_PORT || "8174"),
  },
});
