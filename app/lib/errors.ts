export class AppApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AppApiError";
    this.status = status;
  }
}

function getObjectValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong") {
  const value = getObjectValue(error, "value");
  if (
    typeof getObjectValue(value, "_tag") === "string" &&
    typeof getObjectValue(value, "error") === "string"
  ) {
    return getObjectValue(value, "error") as string;
  }

  if (
    typeof getObjectValue(error, "_tag") === "string" &&
    typeof getObjectValue(error, "error") === "string"
  ) {
    return getObjectValue(error, "error") as string;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
