import { loadEnvFile } from "node:process";
import { testDatabaseEnv } from "../../scripts/testDatabase.js";

loadEnvFile();

if (process.env.TEST_DATABASE_URL && process.env.AUTH_DATABASE_URL) {
  Object.assign(process.env, testDatabaseEnv());
  process.env.GOOGLE_CALENDAR_CLIENT_ID ||= "gcal-client-id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET ||= "gcal-client-secret";
  process.env.GOOGLE_CLIENT_ID ||= "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET ||= "google-client-secret";
  process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder";
  process.env.STRIPE_WEBHOOK_SECRET ||= "whsec_test_placeholder";
  process.env.APPLE_CLIENT_ID ||= "apple-client-id";
  process.env.APPLE_TEAM_ID ||= "apple-team-id";
  process.env.APPLE_KEY_ID ||= "apple-key-id";
  process.env.APPLE_PRIVATE_KEY ||=
    "-----BEGIN PRIVATE KEY-----\\nAQAB\\n-----END PRIVATE KEY-----";
}
