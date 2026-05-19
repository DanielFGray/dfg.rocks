import * as v from "valibot";

const envSchema = v.object({
  DATABASE_URL: v.string(),
  AUTH_DATABASE_URL: v.string(),
  VALKEY_URL: v.string(),
  SECRET: v.string(),
  PORT: v.string(),
  ADMIN_EMAIL: v.string(),
  DATABASE_VISITOR: v.string(),
  NODE_ENV: v.optional(v.string()),
  RESEND_API_KEY: v.optional(v.string()),
  VITE_ROOT_URL: v.optional(v.string()),
  UPLOADS_DIR: v.optional(v.string()),
  GOOGLE_CALENDAR_CLIENT_ID: v.optional(v.string()),
  GOOGLE_CALENDAR_CLIENT_SECRET: v.optional(v.string()),
  GOOGLE_CLIENT_ID: v.optional(v.string()),
  GOOGLE_CLIENT_SECRET: v.optional(v.string()),
  APPLE_CLIENT_ID: v.optional(v.string()),
  APPLE_TEAM_ID: v.optional(v.string()),
  APPLE_KEY_ID: v.optional(v.string()),
  APPLE_PRIVATE_KEY: v.optional(v.string()),
});

declare namespace NodeJS {
  interface ProcessEnv extends v.InferOutput<typeof envSchema> {}
}

export const env = v.parse(envSchema, process.env);
