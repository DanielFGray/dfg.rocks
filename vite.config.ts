import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { alphaTabAssetsPlugin } from "./scripts/alphaTabAssetsPlugin.js";
import { devJobRunnerPlugin } from "./scripts/devJobRunnerPlugin.js";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    alphaTabAssetsPlugin(),
    tanstackStart({
      srcDirectory: "app",
    }),
    react(),
    tailwind(),
    devJobRunnerPlugin(),
  ],
  optimizeDeps: {
    exclude: ["@coderline/alphatab"],
  },
  server: {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.VITE_PORT || process.env.PORT || "3000"),
  },
});
