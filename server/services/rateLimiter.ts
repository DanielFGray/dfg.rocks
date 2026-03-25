import { HttpError } from "../pgErrors.js";

export class RateLimitError extends HttpError {
  constructor() {
    super(429, "Too many requests");
  }
}

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

/** In-memory store. Entries auto-expire via resetAt check. Periodic cleanup every 60s. */
const store = new Map<string, RateLimitEntry>();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 60_000);

let disabled = false;

export function checkRateLimit(key: string, max: number, windowMs: number): void {
  if (disabled) return;

  const now = Date.now();
  let entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }
  entry.count++;
  if (entry.count > max) {
    throw new RateLimitError();
  }
}

/** Disable rate limiting (for tests). */
export function disableRateLimiting(): void {
  disabled = true;
}
