import * as S from "effect/Schema";
import { envSchema } from "../server/assertEnv.js";

// Local development tooling: seeding the admin. `ops dev db up` provisions databases and roles
// and writes their URLs to .env.
const devEnvSchema = S.Struct({
  ...envSchema.fields,
  ADMIN_USERNAME: S.optional(S.String),
  ADMIN_NAME: S.optional(S.String),
  ADMIN_PASSWORD: S.optional(S.Redacted(S.String)),
});

export const devEnv = S.decodeUnknownSync(devEnvSchema)(process.env);
