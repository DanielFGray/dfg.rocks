import {
  Apple,
  ArcticFetchError,
  Google,
  OAuth2RequestError,
  generateCodeVerifier,
  generateState,
} from "arctic";
import { Config, Duration, Effect, Redacted } from "effect";
import * as S from "effect/Schema";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { HttpError } from "../pgErrors.js";

const oauthScopeByProvider = {
  google: ["openid", "email", "profile"],
  apple: ["name", "email"],
} as const;

export type OAuthProvider = keyof typeof oauthScopeByProvider;
type OAuthRequestState = {
  state: string;
  redirect?: string;
  codeVerifier?: string;
};

const OAuthRequestStateSchema = S.Struct({
  state: S.String,
  redirect: S.optional(S.String),
  codeVerifier: S.optional(S.String),
});

const appleIssuer = "https://appleid.apple.com";

const appleJwks = createRemoteJWKSet(new URL(`${appleIssuer}/auth/keys`));

function runSync<A, E>(effect: Effect.Effect<A, E>): A {
  return Effect.runSync(effect);
}

function normalizeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

function getRootOrigin(rootUrl: string): URL {
  return new URL(rootUrl);
}

function providerName(provider: OAuthProvider): string {
  return provider === "google" ? "Google" : "Apple";
}

const googleConfig = Effect.gen(function* () {
  return {
    clientId: yield* Config.NonEmptyString("GOOGLE_CLIENT_ID"),
    clientSecret: yield* Config.Redacted("GOOGLE_CLIENT_SECRET"),
  };
}).pipe(Effect.mapError(() => new HttpError(503, "Google OAuth is not configured")));

const appleConfigEffect = Effect.gen(function* () {
  return {
    clientId: yield* Config.NonEmptyString("APPLE_CLIENT_ID"),
    teamId: yield* Config.NonEmptyString("APPLE_TEAM_ID"),
    keyId: yield* Config.NonEmptyString("APPLE_KEY_ID"),
    privateKey: yield* Config.Redacted("APPLE_PRIVATE_KEY"),
  };
}).pipe(Effect.mapError(() => new HttpError(503, "Apple OAuth is not configured")));

const normalizeApplePrivateKey = Effect.fnUntraced(function* (privateKey: string) {
  const normalizedPem = privateKey.replaceAll("\\n", "\n").trim();
  if (!normalizedPem) {
    return yield* new HttpError(503, "Apple OAuth is not configured");
  }
  const base64 = normalizedPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  if (!base64) {
    return yield* new HttpError(500, "Apple OAuth private key is invalid");
  }
  return Uint8Array.from(Buffer.from(base64, "base64"));
});

const getGoogleClientEffect = Effect.fnUntraced(function* (rootUrl: string) {
  const config = yield* googleConfig;
  return new Google(
    config.clientId,
    Redacted.value(config.clientSecret),
    `${rootUrl}/api/oauth/google/callback`,
  );
});

const getAppleClientEffect = Effect.fnUntraced(function* (rootUrl: string) {
  const appleConfig = yield* appleConfigEffect;
  const privateKey = yield* normalizeApplePrivateKey(Redacted.value(appleConfig.privateKey));
  return new Apple(
    appleConfig.clientId,
    appleConfig.teamId,
    appleConfig.keyId,
    privateKey,
    `${rootUrl}/api/oauth/apple/callback`,
  );
});

export const createAuthorizationRequest = Effect.fnUntraced(function* (
  provider: OAuthProvider,
  rootUrl: string,
  redirect?: string,
) {
  const normalizedRedirect = normalizeRedirect(redirect);
  const state = generateState();
  if (provider === "google") {
    const codeVerifier = generateCodeVerifier();
    const url = (yield* getGoogleClientEffect(rootUrl)).createAuthorizationURL(
      state,
      codeVerifier,
      [...oauthScopeByProvider.google],
    );
    url.searchParams.set("access_type", "offline");
    return {
      state: { state, redirect: normalizedRedirect, codeVerifier } satisfies OAuthRequestState,
      url,
    };
  }
  const url = (yield* getAppleClientEffect(rootUrl)).createAuthorizationURL(state, [
    ...oauthScopeByProvider.apple,
  ]);
  url.searchParams.set("response_mode", "form_post");
  return {
    state: { state, redirect: normalizedRedirect } satisfies OAuthRequestState,
    url,
  };
});

export function encodeOAuthState(value: OAuthRequestState): string {
  return runSync(
    Effect.sync(() => Buffer.from(JSON.stringify(value), "utf8").toString("base64url")),
  );
}

export function decodeOAuthState(value: unknown): OAuthRequestState | null {
  if (typeof value !== "string" || !value) {
    return null;
  }
  return runSync(
    Effect.try({
      try: () => {
        const parsed = S.decodeUnknownSync(OAuthRequestStateSchema)(
          JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
        );
        return {
          state: parsed.state,
          redirect: normalizeRedirect(parsed.redirect),
          codeVerifier: parsed.codeVerifier,
        };
      },
      catch: () => null,
    }),
  );
}

export function getOAuthCookieName(provider: OAuthProvider): `oauth_${OAuthProvider}` {
  return `oauth_${provider}`;
}

export function getOAuthRedirectCookieName(
  provider: OAuthProvider,
): `oauth_${OAuthProvider}_redirect` {
  return `oauth_${provider}_redirect`;
}

export const getOAuthCookieOptions = Effect.fnUntraced(function* (
  provider: OAuthProvider,
  rootUrl: string,
) {
  const isProduction = (yield* Config.String("NODE_ENV")) === "production";
  const rootOrigin = getRootOrigin(rootUrl);
  const isLocalhost = rootOrigin.hostname === "localhost" || rootOrigin.hostname === "127.0.0.1";
  const secureCookies = isProduction || rootOrigin.protocol === "https:" || isLocalhost;
  const standardSecureCookies = isProduction || rootOrigin.protocol === "https:";
  return {
    httpOnly: true,
    sameSite: provider === "apple" ? ("none" as const) : ("lax" as const),
    secure: provider === "apple" ? secureCookies : standardSecureCookies,
    path: "/api/oauth",
    maxAge: Duration.minutes(10),
  };
});

export function encodeOAuthRedirect(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeOAuthRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  return runSync(
    Effect.try({
      try: () => normalizeRedirect(Buffer.from(value, "base64url").toString("utf8")),
      catch: () => undefined,
    }),
  );
}

export function getOAuthRedirectTarget(value: unknown): string {
  return normalizeRedirect(value) ?? "/dashboard";
}

export const exchangeGoogleCode = Effect.fnUntraced(function* (
  rootUrl: string,
  code: string,
  codeVerifier: string,
) {
  const client = yield* getGoogleClientEffect(rootUrl);
  return yield* Effect.tryPromise({
    try: () => client.validateAuthorizationCode(code, codeVerifier),
    catch: (error) => mapOAuthError("google", error),
  });
});

export const exchangeAppleCode = Effect.fnUntraced(function* (rootUrl: string, code: string) {
  const client = yield* getAppleClientEffect(rootUrl);
  return yield* Effect.tryPromise({
    try: () => client.validateAuthorizationCode(code),
    catch: (error) => mapOAuthError("apple", error),
  });
});

export const verifyAppleIdToken = Effect.fnUntraced(function* (idToken: string) {
  const appleConfig = yield* appleConfigEffect;
  return yield* Effect.tryPromise({
    try: () =>
      jwtVerify(idToken, appleJwks, {
        issuer: appleIssuer,
        audience: appleConfig.clientId,
      }).then((verified) => verified.payload),
    catch: () => new HttpError(400, "Invalid Apple id_token"),
  });
});

function mapOAuthError(provider: OAuthProvider, error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof OAuth2RequestError) {
    return new HttpError(400, `${providerName(provider)} OAuth request failed (${error.code})`);
  }
  if (error instanceof ArcticFetchError) {
    return new HttpError(502, `${providerName(provider)} OAuth request failed`);
  }
  return new HttpError(502, `${providerName(provider)} OAuth failed`);
}
