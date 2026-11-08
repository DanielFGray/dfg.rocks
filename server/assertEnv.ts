import * as S from "effect/Schema";

// What the server and worker read at runtime. Database setup values for local development live in
// scripts/devEnv.ts, because the deploy platform provisions roles and never passes them.
export const envSchema = S.Struct({
  DATABASE_URL: S.String,
  AUTH_DATABASE_URL: S.String,
  ADMIN_EMAIL: S.String,
  DATABASE_VISITOR: S.String,
  NODE_ENV: S.String,
  VITE_ROOT_URL: S.String,
  UPLOADS_DIR: S.optional(S.String),
  S3_ENDPOINT: S.optional(S.String),
  S3_REGION: S.optional(S.String),
  S3_BUCKET: S.optional(S.String),
  S3_ACCESS_KEY_ID: S.optional(S.String),
  S3_SECRET_ACCESS_KEY: S.optional(S.RedactedFromValue(S.String)),
  MAIL_PROVIDER: S.optional(S.String),
  EMAIL_FROM: S.optional(S.String),
  CLOUDFLARE_EMAIL_API_TOKEN: S.optional(S.RedactedFromValue(S.String)),
  GOOGLE_CALENDAR_CLIENT_ID: S.optional(S.String),
  GOOGLE_CALENDAR_CLIENT_SECRET: S.optional(S.RedactedFromValue(S.String)),
  GOOGLE_CLIENT_ID: S.optional(S.String),
  GOOGLE_CLIENT_SECRET: S.optional(S.RedactedFromValue(S.String)),
  APPLE_CLIENT_ID: S.optional(S.String),
  APPLE_TEAM_ID: S.optional(S.String),
  APPLE_KEY_ID: S.optional(S.String),
  APPLE_PRIVATE_KEY: S.optional(S.RedactedFromValue(S.String)),
});

declare namespace NodeJS {
  interface ProcessEnv extends S.Schema.Type<typeof envSchema> {}
}

export const env = S.decodeUnknownSync(envSchema)(process.env);
