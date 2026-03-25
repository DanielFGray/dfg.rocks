const rootUrl = process.env.VITE_ROOT_URL ?? "http://localhost:3000";

export const oauthConfig = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: `${rootUrl}/api/oauth/google/callback`,
  },
  apple: {
    clientId: process.env.APPLE_CLIENT_ID ?? "",
    teamId: process.env.APPLE_TEAM_ID ?? "",
    keyId: process.env.APPLE_KEY_ID ?? "",
    privateKey: process.env.APPLE_PRIVATE_KEY ?? "",
    redirectUri: `${rootUrl}/api/oauth/apple/callback`,
  },
} as const;
