import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { HttpError } from "../pgErrors.js";
import { AuthenticatedRouteService } from "../services/authenticatedRouteService.js";
import { SessionService } from "../services/sessionService.js";
import { expireSessionCookie } from "./raw.js";
import { adaptSignedInErrors } from "../httpApiErrors.js";

export const AccountsApiGroupLive = HttpApiBuilder.group(Contract, "accounts", (handlers) =>
  handlers
    .handle(
      "requestDeleteAccount",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.requestDeleteAccount(auth.session.id),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "confirmDeleteAccount",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const deleted = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.confirmDeleteAccount(auth.session.id, payload.token),
        );
        if (!deleted) {
          return yield* new HttpError(400, "Invalid or expired deletion token");
        }
        yield* SessionService.use((sessionService) =>
          sessionService.deleteAllUserSessions(auth.user.id),
        );
        return yield* expireSessionCookie(
          HttpServerResponse.jsonUnsafe({ success: true as const }),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "myEmails",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        const rows = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.myEmails(auth.session.id),
        );
        return rows.map((row) => ({
          ...row,
          created_at: row.created_at.toISOString(),
        }));
      }, adaptSignedInErrors),
    )
    .handle(
      "addMyEmail",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const row = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.addMyEmail(auth.session.id, payload.email),
        );
        return {
          ...row,
          created_at: row.created_at.toISOString(),
        };
      }, adaptSignedInErrors),
    )
    .handle(
      "deleteMyEmail",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.deleteMyEmail(auth.session.id, params.id),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "makePrimaryEmail",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const row = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.makePrimaryEmail(auth.session.id, params.id),
        );
        return {
          ...row,
          created_at: row.created_at.toISOString(),
        };
      }, adaptSignedInErrors),
    )
    .handle(
      "resendEmailVerification",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.resendEmailVerification(auth.session.id, params.id),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "switchActiveStudent",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        if (auth.user.role !== "parent") {
          return yield* new HttpError(403, "Only parents can switch active student");
        }
        yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.switchActiveStudent(
            auth.session.id,
            auth.user.id,
            payload.student_id,
          ),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    ),
);
