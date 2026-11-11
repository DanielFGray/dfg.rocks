import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import { Schema as S, SchemaTransformation } from "effect";

// The platform health contract (server-ansible docs/design/health-checks.md). Its group sits
// outside the "/api" prefix because the platform requests the root path, /healthz.
export const HealthResponse = S.Struct({ status: S.Literal("ok"), commit: S.String });

export class HealthUnavailableError extends S.TaggedError<HealthUnavailableError>()(
  "HealthUnavailableError",
  { commit: S.String, failed: S.Array(S.String) },
) {}

// The wire body is the contract's 503 shape; `_tag` stays off the wire.
export const HealthUnavailableErrorSchema = S.Struct({
  status: S.Literal("error"),
  commit: S.String,
  failed: S.Array(S.String),
}).pipe(
  S.decodeTo(
    S.toType(HealthUnavailableError),
    SchemaTransformation.transform({
      decode: ({ commit, failed }) => new HealthUnavailableError({ commit, failed }),
      encode: ({ commit, failed }) => ({ status: "error" as const, commit, failed }),
    }),
  ),
  HttpApiSchema.status(503),
);

export const healthGroup = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("healthz", "/healthz", {
    success: HealthResponse,
    error: [HealthUnavailableErrorSchema],
  }),
);
