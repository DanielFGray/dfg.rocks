const required = [
  "DATABASE_URL",
  "AUTH_DATABASE_URL",
  "VALKEY_URL",
  "SECRET",
  "PORT",
  "ADMIN_EMAIL",
] as const;

type EnvKey =
  | (typeof required)[number]
  | "NODE_ENV"
  | "RESEND_API_KEY"
  | "VITE_ROOT_URL"
  | "DATABASE_VISITOR"
  | "UPLOADS_DIR";

function getEnv(): Record<EnvKey, string> {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
  return process.env as unknown as Record<EnvKey, string>;
}

export const env = getEnv();
