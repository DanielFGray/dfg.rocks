import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Schema as S } from "effect";
import { GcalStatus, SuccessResponse } from "../schemas.js";
import { adminErrors } from "../httpApiErrors.js";

export const GcalCallbackQuery = S.Struct({
  error: S.optional(S.String),
  code: S.optional(S.String),
  state: S.optional(S.String),
});

export const calendarAdminGroup = HttpApiGroup.make("calendarAdmin")
  // Browser redirects to and from Google for the calendar connection.
  .add(HttpApiEndpoint.get("gcalConnect", "/gcal/connect", { error: adminErrors }))
  .add(
    HttpApiEndpoint.get("gcalCallback", "/gcal/callback", {
      error: adminErrors,
      query: GcalCallbackQuery,
    }),
  )
  .add(
    HttpApiEndpoint.get("gcalStatus", "/gcal/status", {
      error: adminErrors,
      success: GcalStatus,
    }),
  )
  .add(
    HttpApiEndpoint.post("gcalDisconnect", "/gcal/disconnect", {
      error: adminErrors,
      success: SuccessResponse,
    }),
  )
  .prefix("/api/admin");
