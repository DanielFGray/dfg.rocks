import { defineConfig } from "vite";
import { fibrae } from "fibrae/vite";

export default defineConfig({
  plugins: [
    fibrae({
      entry: "./src/app.tsx",
      client: "./src/client.tsx",
      title: "Daniel Gray | Music Lessons in Galveston, TX",
    }),
  ],
  server: {
    host: process.env.HOST || "localhost",
    port: 5174,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  esbuild: {
    jsx: "transform",
    jsxDev: false,
    jsxFactory: "jsx",
    jsxFragment: "Fragment",
    jsxInject: `import { jsx, Fragment } from 'fibrae/jsx-runtime'`,
  },
  optimizeDeps: {
    include: ["@effect-atom/atom", "effect", "@effect/platform", "@effect/platform-browser"],
  },
  resolve: {
    dedupe: ["effect"],
  },
});
