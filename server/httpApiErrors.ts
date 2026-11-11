import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import {
  BadGatewayError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  type HttpApiError,
  InternalServerError,
  LockedError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnauthorizedError,
} from "../shared/httpApiErrors.js";
import { HttpError } from "./pgErrors.js";

const internalServerError = () => new InternalServerError({ error: "Internal Server Error" });

export type HttpApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 423 | 429 | 500 | 502 | 503;

export type AllowedHttpApiErrorStatuses =
  | readonly HttpApiErrorStatus[]
  | ReadonlySet<HttpApiErrorStatus>;

export type HttpApiErrorForStatus<Status extends HttpApiErrorStatus> = Status extends 400
  ? BadRequestError
  : Status extends 401
    ? UnauthorizedError
    : Status extends 403
      ? ForbiddenError
      : Status extends 404
        ? NotFoundError
        : Status extends 409
          ? ConflictError
          : Status extends 413
            ? PayloadTooLargeError
            : Status extends 423
              ? LockedError
              : Status extends 429
                ? TooManyRequestsError
                : Status extends 500
                  ? InternalServerError
                  : Status extends 502
                    ? BadGatewayError
                    : ServiceUnavailableError;

type AllowedStatus<Allowed extends AllowedHttpApiErrorStatuses> =
  Allowed extends readonly (infer Status extends HttpApiErrorStatus)[]
    ? Status
    : Allowed extends ReadonlySet<infer Status extends HttpApiErrorStatus>
      ? Status
      : never;

function isHttpApiError(error: unknown): error is HttpApiError {
  return (
    error instanceof BadRequestError ||
    error instanceof UnauthorizedError ||
    error instanceof ForbiddenError ||
    error instanceof NotFoundError ||
    error instanceof ConflictError ||
    error instanceof PayloadTooLargeError ||
    error instanceof LockedError ||
    error instanceof TooManyRequestsError ||
    error instanceof InternalServerError ||
    error instanceof BadGatewayError ||
    error instanceof ServiceUnavailableError
  );
}

function httpApiErrorStatus(error: HttpApiError): HttpApiErrorStatus {
  switch (error._tag) {
    case "BadRequestError":
      return 400;
    case "UnauthorizedError":
      return 401;
    case "ForbiddenError":
      return 403;
    case "NotFoundError":
      return 404;
    case "ConflictError":
      return 409;
    case "PayloadTooLargeError":
      return 413;
    case "LockedError":
      return 423;
    case "TooManyRequestsError":
      return 429;
    case "InternalServerError":
      return 500;
    case "BadGatewayError":
      return 502;
    case "ServiceUnavailableError":
      return 503;
  }
}

function isAllowedStatus(
  allowedStatuses: AllowedHttpApiErrorStatuses,
  status: number,
): status is HttpApiErrorStatus {
  return Array.isArray(allowedStatuses)
    ? allowedStatuses.includes(status as HttpApiErrorStatus)
    : (allowedStatuses as ReadonlySet<HttpApiErrorStatus>).has(status as HttpApiErrorStatus);
}

export function httpErrorToHttpApiError(error: HttpError): HttpApiError | undefined {
  const body = { error: error.message };

  switch (error.status) {
    case 400:
      return new BadRequestError(body);
    case 401:
      return new UnauthorizedError(body);
    case 403:
      return new ForbiddenError(body);
    case 404:
      return new NotFoundError(body);
    case 409:
      return new ConflictError(body);
    case 413:
      return new PayloadTooLargeError(body);
    case 423:
      return new LockedError(body);
    case 429:
      return new TooManyRequestsError(body);
    case 500:
      return internalServerError();
    case 502:
      return new BadGatewayError(body);
    case 503:
      return new ServiceUnavailableError(body);
    default:
      return undefined;
  }
}

/**
 * Converts failures at the typed HttpApi boundary while leaving interruption intact.
 * Defects and unsupported failures are logged with their full cause and exposed as a
 * sanitized 500 error.
 */
export function adaptHttpApiErrors<A, E, R, const Allowed extends AllowedHttpApiErrorStatuses>(
  self: Effect.Effect<A, E, R>,
  allowedStatuses: Allowed,
): Effect.Effect<A, HttpApiErrorForStatus<AllowedStatus<Allowed>>, R> {
  return Effect.catchCause(self, (cause) => {
    if (Cause.hasInterrupts(cause)) {
      return Effect.failCause(cause as Cause.Cause<HttpApiErrorForStatus<AllowedStatus<Allowed>>>);
    }

    const failure = Cause.findError(cause);
    if (Result.isSuccess(failure)) {
      if (
        isHttpApiError(failure.success) &&
        isAllowedStatus(allowedStatuses, httpApiErrorStatus(failure.success))
      ) {
        return Effect.fail(failure.success as HttpApiErrorForStatus<AllowedStatus<Allowed>>);
      }
      if (
        failure.success instanceof HttpError &&
        isAllowedStatus(allowedStatuses, failure.success.status)
      ) {
        const apiError = httpErrorToHttpApiError(failure.success);
        if (apiError !== undefined) {
          return Effect.fail(apiError as HttpApiErrorForStatus<AllowedStatus<Allowed>>);
        }
      }
    }

    return Effect.logError("Unexpected HTTP API failure", cause).pipe(
      Effect.andThen(
        Effect.fail(internalServerError() as HttpApiErrorForStatus<AllowedStatus<Allowed>>),
      ),
    );
  });
}

/** Maps a signed-in endpoint's failures to the statuses of `signedInErrors`. */
export const adaptSignedInErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, [400, 401, 403, 404, 409, 500, 502, 503] as const);

/** Maps an admin endpoint's failures to the statuses of `adminErrors`. */
export const adaptAdminErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, [400, 401, 403, 404, 409, 413, 500, 502, 503] as const);
