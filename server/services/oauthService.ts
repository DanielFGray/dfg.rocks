import {
  Apple,
  ArcticFetchError,
  Google,
  OAuth2RequestError,
  generateCodeVerifier,
  generateState,
} from "arctic";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../assertEnv.js";
import { HttpError } from "../pgErrors.js";

const oauthScopeByProvider = {
  google: ["openid", "email", "profile"],
  apple: ["name", "email"],
} as const;

export const oauthConfig = {
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
  },
  apple: {
    clientId: env.APPLE_CLIENT_ID ?? "",
    teamId: env.APPLE_TEAM_ID ?? "",
    keyId: env.APPLE_KEY_ID ?? "",
    privateKey: env.APPLE_PRIVATE_KEY ?? "",
  },
} as const;

export type OAuthProvider = keyof typeof oauthScopeByProvider;

type OAuthRequestState = {
  state: string;
  redirect?: string;
  codeVerifier?: string;
};

const appleIssuer = "https://appleid.apple.com";
const appleJwks = createRemoteJWKSet(new URL(`${appleIssuer}/auth/keys`));

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

function assertGoogleConfigured(): void {
  if (!oauthConfig.google.clientId || !oauthConfig.google.clientSecret) {
    throw new HttpError(503, "Google OAuth is not configured");
  }
}

function normalizeApplePrivateKey(privateKey: string): Uint8Array {
  const normalizedPem = privateKey.replaceAll("\\n", "\n").trim();
  if (!normalizedPem) {
    throw new HttpError(503, "Apple OAuth is not configured");
  }

  const base64 = normalizedPem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  if (!base64) {
    throw new HttpError(500, "Apple OAuth private key is invalid");
  }

  return Uint8Array.from(Buffer.from(base64, "base64"));
}

function assertAppleConfigured(): void {
  if (
    !oauthConfig.apple.clientId ||
    !oauthConfig.apple.teamId ||
    !oauthConfig.apple.keyId ||
    !oauthConfig.apple.privateKey
  ) {
    throw new HttpError(503, "Apple OAuth is not configured");
  }
}

function getGoogleClient(rootUrl: string): Google {
  assertGoogleConfigured();
  return new Google(
    oauthConfig.google.clientId,
    oauthConfig.google.clientSecret,
    `${rootUrl}/api/oauth/google/callback`,
  );
}

function getAppleClient(rootUrl: string): Apple {
  assertAppleConfigured();
  return new Apple(
    oauthConfig.apple.clientId,
    oauthConfig.apple.teamId,
    oauthConfig.apple.keyId,
    normalizeApplePrivateKey(oauthConfig.apple.privateKey),
    `${rootUrl}/api/oauth/apple/callback`,
  );
}

export function createAuthorizationRequest(
  provider: "google",
  rootUrl: string,
  redirect?: string,
): {
  state: OAuthRequestState;
  url: URL;
};
export function createAuthorizationRequest(
  provider: "apple",
  rootUrl: string,
  redirect?: string,
): {
  state: OAuthRequestState;
  url: URL;
};
export function createAuthorizationRequest(
  provider: OAuthProvider,
  rootUrl: string,
  redirect?: string,
) {
  const normalizedRedirect = normalizeRedirect(redirect);
  const state = generateState();

  if (provider === "google") {
    const codeVerifier = generateCodeVerifier();
    const url = getGoogleClient(rootUrl).createAuthorizationURL(state, codeVerifier, [
      ...oauthScopeByProvider.google,
    ]);
    url.searchParams.set("access_type", "offline");
    return {
      state: { state, redirect: normalizedRedirect, codeVerifier },
      url,
    };
  }

  const url = getAppleClient(rootUrl).createAuthorizationURL(state, [
    ...oauthScopeByProvider.apple,
  ]);
  url.searchParams.set("response_mode", "form_post");
  return {
    state: { state, redirect: normalizedRedirect },
    url,
  };
}

export function encodeOAuthState(value: OAuthRequestState): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeOAuthState(value: unknown): OAuthRequestState | null {
  if (typeof value !== "string" || !value) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as {
      state?: unknown;
      redirect?: unknown;
      codeVerifier?: unknown;
    };

    if (typeof parsed.state !== "string" || !parsed.state) {
      return null;
    }

    if (
      parsed.codeVerifier !== undefined &&
      typeof parsed.codeVerifier !== "string"
    ) {
      return null;
    }

    const redirect = normalizeRedirect(parsed.redirect);
    return {
      state: parsed.state,
      redirect,
      codeVerifier: parsed.codeVerifier,
    };
  } catch {
    return null;
  }
}

export function getOAuthCookieName(
  provider: OAuthProvider,
): `oauth_${OAuthProvider}` {
  return `oauth_${provider}`;
}

export function getOAuthRedirectCookieName(
  provider: OAuthProvider,
): `oauth_${OAuthProvider}_redirect` {
  return `oauth_${provider}_redirect`;
}

export function getOAuthCookieOptions(provider: OAuthProvider, rootUrl: string) {
  const rootOrigin = getRootOrigin(rootUrl);
  const isLocalhost =
    rootOrigin.hostname === "localhost" || rootOrigin.hostname === "127.0.0.1";
  const secureCookies =
    env.NODE_ENV === "production" || rootOrigin.protocol === "https:" || isLocalhost;
  const standardSecureCookies =
    env.NODE_ENV === "production" || rootOrigin.protocol === "https:";
  return {
    httpOnly: true,
    sameSite: provider === "apple" ? ("none" as const) : ("lax" as const),
    secure: provider === "apple" ? secureCookies : standardSecureCookies,
    path: "/api/oauth",
    maxAge: 60 * 10,
  };
}

export function encodeOAuthRedirect(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeOAuthRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;

  try {
    return normalizeRedirect(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

export function getOAuthRedirectTarget(value: unknown): string {
  return normalizeRedirect(value) ?? "/dashboard";
}

export async function exchangeGoogleCode(rootUrl: string, code: string, codeVerifier: string) {
  try {
    return await getGoogleClient(rootUrl).validateAuthorizationCode(
      code,
      codeVerifier,
    );
  } catch (error) {
    throw mapOAuthError("google", error);
  }
}

export async function exchangeAppleCode(rootUrl: string, code: string) {
  try {
    return await getAppleClient(rootUrl).validateAuthorizationCode(code);
  } catch (error) {
    throw mapOAuthError("apple", error);
  }
}

export async function verifyAppleIdToken(idToken: string): Promise<JWTPayload> {
  try {
    const verified = await jwtVerify(idToken, appleJwks, {
      issuer: appleIssuer,
      audience: oauthConfig.apple.clientId,
    });
    return verified.payload;
  } catch {
    throw new HttpError(400, "Invalid Apple id_token");
  }
}

function mapOAuthError(provider: OAuthProvider, error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof OAuth2RequestError) {
    return new HttpError(
      400,
      `${providerName(provider)} OAuth request failed (${error.code})`,
    );
  }
  if (error instanceof ArcticFetchError) {
    return new HttpError(502, `${providerName(provider)} OAuth request failed`);
  }
  return new HttpError(502, `${providerName(provider)} OAuth failed`);
}
