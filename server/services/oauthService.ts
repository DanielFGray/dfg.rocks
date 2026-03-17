import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export class OAuthConfig extends Context.Tag("OAuthConfig")<
  OAuthConfig,
  {
    readonly google: {
      readonly clientId: string;
      readonly clientSecret: string;
      readonly redirectUri: string;
    };
    readonly apple: {
      readonly clientId: string;
      readonly teamId: string;
      readonly keyId: string;
      readonly privateKey: string;
      readonly redirectUri: string;
    };
  }
>() {}

export const OAuthConfigLive = Layer.effect(
  OAuthConfig,
  Effect.sync(() => {
    const rootUrl = process.env.VITE_ROOT_URL ?? "http://localhost:3000";
    return OAuthConfig.of({
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
    });
  }),
);
