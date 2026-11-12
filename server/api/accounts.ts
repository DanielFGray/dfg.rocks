import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { HttpError } from "../pgErrors.js";
import { AccountService } from "../services/accountService.js";
import { SessionService } from "../services/sessionService.js";
import { expireSessionCookie } from "./raw.js";
import { adaptSignedInErrors } from "../httpApiErrors.js";

export const AccountsApiGroupLive = HttpApiBuilder.group(Contract, "accounts", (handlers) =>
  handlers
    .handle(
      "requestDeleteAccount",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        yield* AccountService.use((accountService) =>
          accountService.requestDeleteAccount().pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "confirmDeleteAccount",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const deleted = yield* AccountService.use((accountService) =>
          accountService.confirmDeleteAccount(payload.token).pipe(withAuthContext(auth.session.id)),
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
        const rows = yield* AccountService.use((accountService) =>
          accountService.myEmails().pipe(withAuthContext(auth.session.id)),
        );
        return rows;
      }, adaptSignedInErrors),
    )
    .handle(
      "addMyEmail",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const row = yield* AccountService.use((accountService) =>
          accountService.addMyEmail(payload.email).pipe(withAuthContext(auth.session.id)),
        );
        return row;
      }, adaptSignedInErrors),
    )
    .handle(
      "deleteMyEmail",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        yield* AccountService.use((accountService) =>
          accountService.deleteMyEmail(params.id).pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "makePrimaryEmail",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const row = yield* AccountService.use((accountService) =>
          accountService.makePrimaryEmail(params.id).pipe(withAuthContext(auth.session.id)),
        );
        return row;
      }, adaptSignedInErrors),
    )
    .handle(
      "resendEmailVerification",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        yield* AccountService.use((accountService) =>
          accountService.resendEmailVerification(params.id).pipe(withAuthContext(auth.session.id)),
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
        yield* AccountService.use((accountService) =>
          accountService
            .switchActiveStudent(auth.session.id, auth.user.id, payload.student_id)
            .pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    ),
);
