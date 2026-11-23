import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { adaptAdminErrors } from "../httpApiErrors.js";
import { adaptPublicHttpApiErrors } from "./public.js";
import { checkRateLimit } from "../rateLimit.js";
import { Invitations } from "../services/invitations.js";
import { setSessionCookie } from "./raw.js";

export const InvitationsStaffApiGroupLive = HttpApiBuilder.group(
  Contract,
  "invitationsStaff",
  (handlers) =>
    handlers
      .handle(
        "inviteAccount",
        Effect.fnUntraced(function* ({ payload }) {
          const auth = yield* CurrentSession;
          return yield* Invitations.use((invitations) =>
            invitations
              .inviteAccount({
                name: payload.name,
                email: payload.email,
                role: payload.role,
                familyId: payload.family_id,
                message: payload.message,
              })
              .pipe(withAuthContext(auth.session.id)),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "pendingInvitations",
        Effect.fnUntraced(function* () {
          const auth = yield* CurrentSession;
          return yield* Invitations.use((invitations) =>
            invitations.pendingInvitations().pipe(withAuthContext(auth.session.id)),
          );
        }, adaptAdminErrors),
      )
      .handle(
        "resendInvitation",
        Effect.fnUntraced(function* ({ params }) {
          const auth = yield* CurrentSession;
          yield* Invitations.use((invitations) =>
            invitations.resendInvitation(params.id).pipe(withAuthContext(auth.session.id)),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      ),
);

export const InvitationsPublicApiGroupLive = HttpApiBuilder.group(
  Contract,
  "invitationsPublic",
  (handlers) =>
    handlers.handle(
      "claimInvitation",
      Effect.fnUntraced(function* ({ request, params, payload }) {
        // The same budget as the family invitation page: both test a secret from an email.
        yield* checkRateLimit("accept-invite", request.headers);
        const session = yield* Invitations.use((invitations) =>
          invitations.claim(params.id, payload.token),
        );
        return yield* setSessionCookie(
          HttpServerResponse.jsonUnsafe(session.response),
          session.token,
          session.expiresAt,
        );
      }, adaptPublicHttpApiErrors),
    ),
);
