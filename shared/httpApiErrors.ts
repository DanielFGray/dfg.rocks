import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import { Schema as S, SchemaTransformation } from "effect";

const WireError = S.Struct({ error: S.String });

// Errors travel as `{ error }` with an HTTP status; decoding rebuilds the tagged error with `make`.
function wireSchema<Error extends S.Top & { readonly Type: { readonly error: string } }>(
  schema: Error,
  make: (error: string) => Error["Type"],
  status: number,
) {
  return WireError.pipe(
    S.decodeTo(
      S.toType(schema),
      SchemaTransformation.transform({
        decode: ({ error }) => make(error),
        encode: ({ error }) => ({ error }),
      }),
    ),
    HttpApiSchema.status(status),
  );
}

export class BadRequestError extends S.TaggedError<BadRequestError>()("BadRequestError", {
  error: S.String,
}) {}
export const BadRequestErrorSchema = wireSchema(
  BadRequestError,
  (error) => new BadRequestError({ error }),
  400,
);

export class UnauthorizedError extends S.TaggedError<UnauthorizedError>()("UnauthorizedError", {
  error: S.String,
}) {}
export const UnauthorizedErrorSchema = wireSchema(
  UnauthorizedError,
  (error) => new UnauthorizedError({ error }),
  401,
);

export class ForbiddenError extends S.TaggedError<ForbiddenError>()("ForbiddenError", {
  error: S.String,
}) {}
export const ForbiddenErrorSchema = wireSchema(
  ForbiddenError,
  (error) => new ForbiddenError({ error }),
  403,
);

export class NotFoundError extends S.TaggedError<NotFoundError>()("NotFoundError", {
  error: S.String,
}) {}
export const NotFoundErrorSchema = wireSchema(
  NotFoundError,
  (error) => new NotFoundError({ error }),
  404,
);

export class ConflictError extends S.TaggedError<ConflictError>()("ConflictError", {
  error: S.String,
}) {}
export const ConflictErrorSchema = wireSchema(
  ConflictError,
  (error) => new ConflictError({ error }),
  409,
);

export class PayloadTooLargeError extends S.TaggedError<PayloadTooLargeError>()(
  "PayloadTooLargeError",
  { error: S.String },
) {}
export const PayloadTooLargeErrorSchema = wireSchema(
  PayloadTooLargeError,
  (error) => new PayloadTooLargeError({ error }),
  413,
);

export class LockedError extends S.TaggedError<LockedError>()("LockedError", {
  error: S.String,
}) {}
export const LockedErrorSchema = wireSchema(
  LockedError,
  (error) => new LockedError({ error }),
  423,
);

export class TooManyRequestsError extends S.TaggedError<TooManyRequestsError>()(
  "TooManyRequestsError",
  { error: S.String },
) {}
export const TooManyRequestsErrorSchema = wireSchema(
  TooManyRequestsError,
  (error) => new TooManyRequestsError({ error }),
  429,
);

export class InternalServerError extends S.TaggedError<InternalServerError>()(
  "InternalServerError",
  { error: S.String },
) {}
export const InternalServerErrorSchema = wireSchema(
  InternalServerError,
  (error) => new InternalServerError({ error }),
  500,
);

export class BadGatewayError extends S.TaggedError<BadGatewayError>()("BadGatewayError", {
  error: S.String,
}) {}
export const BadGatewayErrorSchema = wireSchema(
  BadGatewayError,
  (error) => new BadGatewayError({ error }),
  502,
);

export class ServiceUnavailableError extends S.TaggedError<ServiceUnavailableError>()(
  "ServiceUnavailableError",
  { error: S.String },
) {}
export const ServiceUnavailableErrorSchema = wireSchema(
  ServiceUnavailableError,
  (error) => new ServiceUnavailableError({ error }),
  503,
);

export type HttpApiError =
  | BadRequestError
  | UnauthorizedError
  | ForbiddenError
  | NotFoundError
  | ConflictError
  | PayloadTooLargeError
  | LockedError
  | TooManyRequestsError
  | InternalServerError
  | BadGatewayError
  | ServiceUnavailableError;

export const HttpApiErrorSchemas = [
  BadRequestErrorSchema,
  UnauthorizedErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  ConflictErrorSchema,
  PayloadTooLargeErrorSchema,
  LockedErrorSchema,
  TooManyRequestsErrorSchema,
  InternalServerErrorSchema,
  BadGatewayErrorSchema,
  ServiceUnavailableErrorSchema,
] as const;

/** The errors an endpoint for signed-in users can answer. */
export const signedInErrors = [
  BadRequestErrorSchema,
  UnauthorizedErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  ConflictErrorSchema,
  InternalServerErrorSchema,
  BadGatewayErrorSchema,
  ServiceUnavailableErrorSchema,
] as const;

/** The errors an admin endpoint can answer: the signed-in errors and 413 for uploads. */
export const adminErrors = [
  BadRequestErrorSchema,
  UnauthorizedErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  ConflictErrorSchema,
  PayloadTooLargeErrorSchema,
  InternalServerErrorSchema,
  BadGatewayErrorSchema,
  ServiceUnavailableErrorSchema,
] as const;
