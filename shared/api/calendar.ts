import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Admin, Csrf, Session } from "./guards.js";
import { Schema as S } from "effect";
import { GcalStatus, SuccessResponse } from "../schemas.js";
import { adminErrors } from "../httpApiErrors.js";

export const GcalCallbackQuery = S.Struct({
  error: S.optional(S.String),
  code: S.optional(S.String),
  state: S.optional(S.String),
});

/**
 * The browser's redirects to and from Google for the calendar connection. A redirect cannot carry
 * the CSRF header, so these two endpoints have no Csrf guard.
 */
export const calendarConnectAdminGroup = HttpApiGroup.make("calendarConnectAdmin")
  .add(HttpApiEndpoint.get("gcalConnect", "/gcal/connect", { error: adminErrors }))
  .add(
    HttpApiEndpoint.get("gcalCallback", "/gcal/callback", {
      error: adminErrors,
      query: GcalCallbackQuery,
    }),
  )
  .middleware(Admin)
  .middleware(Session)
  .prefix("/api/admin");

export const calendarAdminGroup = HttpApiGroup.make("calendarAdmin")
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
  .middleware(Csrf)
  .middleware(Admin)
  .middleware(Session)
  .prefix("/api/admin");
