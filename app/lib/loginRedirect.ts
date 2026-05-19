const LOGIN_REDIRECT_STORAGE_KEY = "dfg.loginRedirect";

export function normalizeLoginRedirect(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

export function rememberLoginRedirect(redirect?: string): void {
  if (typeof window === "undefined") return;

  const normalized = normalizeLoginRedirect(redirect);
  if (normalized) {
    window.sessionStorage.setItem(LOGIN_REDIRECT_STORAGE_KEY, normalized);
  } else {
    window.sessionStorage.removeItem(LOGIN_REDIRECT_STORAGE_KEY);
  }
}

export function consumeLoginRedirect(explicitRedirect?: string): string | undefined {
  const explicit = normalizeLoginRedirect(explicitRedirect);
  if (typeof window === "undefined") {
    return explicit;
  }

  const stored = normalizeLoginRedirect(
    explicit ?? window.sessionStorage.getItem(LOGIN_REDIRECT_STORAGE_KEY),
  );
  window.sessionStorage.removeItem(LOGIN_REDIRECT_STORAGE_KEY);
  return stored;
}
