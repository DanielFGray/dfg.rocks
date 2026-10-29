#!/usr/bin/env bun
/**
 * Production HTTP entry. The TanStack Start build emits a fetch handler for
 * pages and /api, and static client files in dist/client that the handler does
 * not serve. This serves those files first and hands every other request to
 * the handler.
 */
import path from "node:path";
import handler from "./dist/server/server.js";

const clientDir = path.resolve(import.meta.dir, "dist/client");

const server = Bun.serve({
  hostname: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 3000),
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const filePath = path.join(clientDir, decodeURIComponent(pathname));
    if (filePath.startsWith(clientDir + path.sep)) {
      const file = Bun.file(filePath);
      if (await file.exists()) {
        // Hashed build assets never change content under one name.
        const cacheControl = pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600";
        return new Response(file, { headers: { "cache-control": cacheControl } });
      }
    }
    return handler.fetch(request);
  },
});

console.log(`Listening on ${server.url}`);
