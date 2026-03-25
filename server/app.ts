import { Elysia } from "elysia";
import { publicRoutes } from "./routes/public.js";
import { authRoutes } from "./routes/auth.js";
import { authenticatedRoutes } from "./routes/authenticated.js";
import { adminRoutes, materialDownloadRoute } from "./routes/admin.js";
import { env } from "./assertEnv.js";

const app = new Elysia()
  .use(publicRoutes)
  .use(authRoutes)
  .use(authenticatedRoutes)
  .use(adminRoutes)
  .use(materialDownloadRoute);

// Testing routes — non-production only
if (env.NODE_ENV !== "production") {
  const { testingRoutes } = await import("./routes/testing.js");
  app.use(testingRoutes);
}

export { app };
export type App = typeof app;
