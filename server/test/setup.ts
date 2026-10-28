import { loadEnvFile } from "node:process";

loadEnvFile();

function withDatabaseSuffix(connectionString: string, suffix: string): string {
  const url = new URL(connectionString);
  const databaseName = url.pathname.replace(/^\/+/, "");
  if (!databaseName) throw new Error("Connection string is missing a database name");
  url.pathname = `/${databaseName}${suffix}`;
  return url.toString();
}

function forceIpv4(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.hostname === "localhost" || url.hostname === "::1") url.hostname = "127.0.0.1";
  return url.toString();
}

if (process.env.DATABASE_URL && process.env.AUTH_DATABASE_URL) {
  process.env.DATABASE_URL = forceIpv4(withDatabaseSuffix(process.env.DATABASE_URL, "_test"));
  process.env.AUTH_DATABASE_URL = forceIpv4(
    withDatabaseSuffix(process.env.AUTH_DATABASE_URL, "_test"),
  );
  process.env.DATABASE_HOST = "127.0.0.1";
  process.env.NODE_ENV = "test";
  process.env.GOOGLE_CALENDAR_CLIENT_ID ||= "gcal-client-id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET ||= "gcal-client-secret";
  process.env.GOOGLE_CLIENT_ID ||= "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET ||= "google-client-secret";
  process.env.APPLE_CLIENT_ID ||= "apple-client-id";
  process.env.APPLE_TEAM_ID ||= "apple-team-id";
  process.env.APPLE_KEY_ID ||= "apple-key-id";
  process.env.APPLE_PRIVATE_KEY ||= "-----BEGIN PRIVATE KEY-----\\nAQAB\\n-----END PRIVATE KEY-----";
}
