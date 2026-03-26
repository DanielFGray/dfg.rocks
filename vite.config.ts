import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  server: {
    host: process.env.HOST || "localhost",
    port: parseInt(process.env.VITE_PORT || "8174"),
  },
  oxc: {
    jsxRuntime: "automatic",
    jsxImportSource: "react",
  },
  plugins: [tanstackStart({ srcDirectory: "app" }), react()],
});
