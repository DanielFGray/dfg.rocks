import * as v from "valibot";
import { ApiError } from "../../shared/validation.js";

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
  if (error instanceof Error && error.message) {
    return error.message;
  }

  const value = getObjectValue(error, "value");
  const parsedValue = v.safeParse(ApiError, value);
  if (parsedValue.success) {
    return parsedValue.output.error;
  }

  const parsedError = v.safeParse(ApiError, error);
  if (parsedError.success) {
    return parsedError.output.error;
  }

  return fallback;
}
