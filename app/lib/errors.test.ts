import { describe, expect, it } from "vitest";
import {
  BadGatewayError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  LockedError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnauthorizedError,
} from "../../shared/httpApiErrors.js";
import { getErrorMessage } from "./errors.js";

describe("getErrorMessage", () => {
  it.each([
    new BadRequestError({ error: "bad request" }),
    new UnauthorizedError({ error: "unauthorized" }),
    new ForbiddenError({ error: "forbidden" }),
    new NotFoundError({ error: "not found" }),
    new ConflictError({ error: "conflict" }),
    new PayloadTooLargeError({ error: "payload too large" }),
    new LockedError({ error: "locked" }),
    new TooManyRequestsError({ error: "too many requests" }),
    new InternalServerError({ error: "internal server error" }),
    new BadGatewayError({ error: "bad gateway" }),
    new ServiceUnavailableError({ error: "service unavailable" }),
  ])("extracts the error field from tagged $._tag failures", (error) => {
    expect(getErrorMessage(error)).toBe(error.error);
  });

  it("extracts tagged failures wrapped like generated client errors", () => {
    const wrapped = Object.assign(new Error("generated client wrapper"), {
      value: new ConflictError({ error: "course already exists" }),
    });

    expect(getErrorMessage(wrapped)).toBe("course already exists");
  });

  it("does not interpret untagged wire objects as typed API errors", () => {
    expect(getErrorMessage({ error: "untyped response", status: 400 }, "Try again")).toBe(
      "Try again",
    );
  });

  it("uses the message from a plain Error", () => {
    expect(getErrorMessage(new Error("network unavailable"))).toBe("network unavailable");
  });

  it("uses the provided fallback for unknown errors", () => {
    expect(getErrorMessage({ reason: "unknown" }, "Try again later")).toBe("Try again later");
  });
});
