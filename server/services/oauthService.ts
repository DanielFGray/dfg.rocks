import { env } from "../assertEnv.js";

const rootUrl = env.VITE_ROOT_URL ?? "http://localhost:3000";

export const oauthConfig = {
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: `${rootUrl}/api/oauth/google/callback`,
  },
  apple: {
    clientId: env.APPLE_CLIENT_ID ?? "",
    teamId: env.APPLE_TEAM_ID ?? "",
    keyId: env.APPLE_KEY_ID ?? "",
    privateKey: env.APPLE_PRIVATE_KEY ?? "",
    redirectUri: `${rootUrl}/api/oauth/apple/callback`,
  },
} as const;
