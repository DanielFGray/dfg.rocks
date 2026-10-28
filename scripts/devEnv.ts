import * as S from "effect/Schema";
import { envSchema } from "../server/assertEnv.js";

// Local development and test tooling: creating roles and databases, seeding the admin, and
// running the E2E server.
const devEnvSchema = S.Struct({
  ...envSchema.fields,
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
  VITE_PORT: S.optional(S.String),
  PLAYWRIGHT_VITE_PORT: S.optional(S.String),
});

export const devEnv = S.decodeUnknownSync(devEnvSchema)(process.env);
