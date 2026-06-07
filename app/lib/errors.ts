import * as Option from "effect/Option";
import * as S from "effect/Schema";
import { ApiError } from "../../shared/schemas.js";

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

export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong",
) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  const decodeApiError = S.decodeUnknownOption(ApiError);
  const value = getObjectValue(error, "value");
  const parsedValue = decodeApiError(value);
  if (Option.isSome(parsedValue)) {
    return parsedValue.value.error;
  }

  const parsedError = decodeApiError(error);
  if (Option.isSome(parsedError)) {
    return parsedError.value.error;
  }

  return fallback;
}
