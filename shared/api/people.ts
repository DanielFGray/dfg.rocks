import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Admin, Csrf, Session, Staff } from "./guards.js";
import { Schema as S } from "effect";
import { PersonDetail, PersonSummary, UserRole } from "../schemas.js";
import { params } from "./fields.js";
import { adminErrors } from "../httpApiErrors.js";

export const SetUserRolePayload = S.Struct({
  role: UserRole,
});

export const SetUserRoleResponse = S.Struct({
  id: S.String,
  role: UserRole,
});

/** Every account, for staff. Search and the role filter run on the list the client holds. */
export const peopleStaffGroup = HttpApiGroup.make("peopleStaff")
  .add(
    HttpApiEndpoint.get("people", "/people", {
      error: adminErrors,
      success: S.Array(PersonSummary),
    }),
  )
  .add(
    HttpApiEndpoint.get("person", "/people/:id", {
      error: adminErrors,
      params: params("id"),
      success: PersonDetail,
    }),
  )
  .middleware(Staff)
  .middleware(Session)
  .prefix("/api/admin");

export const peopleAdminGroup = HttpApiGroup.make("peopleAdmin")
  .add(
    HttpApiEndpoint.patch("setUserRole", "/people/:id/role", {
      error: adminErrors,
      params: params("id"),
      payload: SetUserRolePayload,
      success: SetUserRoleResponse,
    }),
  )
  .middleware(Csrf)
  .middleware(Admin)
  .middleware(Session)
  .prefix("/api/admin");
