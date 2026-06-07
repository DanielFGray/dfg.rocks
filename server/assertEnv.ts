import * as S from "effect/Schema";

export const envSchema = S.Struct({
  DATABASE_URL: S.String,
  AUTH_DATABASE_URL: S.String,
  VALKEY_URL: S.String,
  SECRET: S.Redacted(S.String),
  PORT: S.String,
  ADMIN_EMAIL: S.String,
  DATABASE_VISITOR: S.String,
  NODE_ENV: S.String,
  API_URL: S.optional(S.String),
  VITE_PORT: S.optional(S.String),
  PLAYWRIGHT_VITE_PORT: S.optional(S.String),
  PLAYWRIGHT_CHROMIUM_PATH: S.optional(S.String),
  CI: S.optional(S.String),
  HOST: S.optional(S.String),
  RESEND_API_KEY: S.optional(S.Redacted(S.String)),
  VITE_ROOT_URL: S.String,
  UPLOADS_DIR: S.optional(S.String),
  ROOT_DATABASE_URL: S.String,
  DATABASE_NAME: S.String,
  DATABASE_OWNER: S.String,
  DATABASE_OWNER_PASSWORD: S.Redacted(S.String),
  DATABASE_AUTHENTICATOR: S.String,
  DATABASE_AUTHENTICATOR_PASSWORD: S.Redacted(S.String),
  SHADOW_DATABASE_PASSWORD: S.Redacted(S.String),
  ADMIN_USERNAME: S.optional(S.String),
  ADMIN_NAME: S.optional(S.String),
  ADMIN_PASSWORD: S.optional(S.Redacted(S.String)),
  AWS_REGION: S.optional(S.String),
  AWS_ACCESS_KEY_ID: S.optional(S.String),
  AWS_SECRET_ACCESS_KEY: S.optional(S.Redacted(S.String)),
  GOOGLE_CALENDAR_CLIENT_ID: S.optional(S.String),
  GOOGLE_CALENDAR_CLIENT_SECRET: S.optional(S.Redacted(S.String)),
  GOOGLE_CLIENT_ID: S.optional(S.String),
  GOOGLE_CLIENT_SECRET: S.optional(S.Redacted(S.String)),
  APPLE_CLIENT_ID: S.optional(S.String),
  APPLE_TEAM_ID: S.optional(S.String),
  APPLE_KEY_ID: S.optional(S.String),
  APPLE_PRIVATE_KEY: S.optional(S.Redacted(S.String)),
});

declare namespace NodeJS {
  interface ProcessEnv extends S.Schema.Type<typeof envSchema> {}
}

export const env = S.decodeUnknownSync(envSchema)(process.env);
