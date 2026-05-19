/** Extract a displayable error string from TanStack Form's field errors array. */
export function fieldError(errors: Array<unknown>): string | undefined {
  const e = errors[0];
  if (!e) return undefined;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const message = (e as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
  }
  return undefined;
}
