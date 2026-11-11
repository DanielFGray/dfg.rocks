import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect, Config } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { HttpError } from "../pgErrors.js";
import { FamilyService } from "../services/familyService.js";
import { adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";

export const FamiliesApiGroupLive = HttpApiBuilder.group(Contract, "families", (handlers) =>
  handlers
    .handle(
      "createChild",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        if (auth.user.role !== "parent") {
          return yield* new HttpError(403, "Only parents can create child accounts");
        }
        return yield* FamilyService.use((familyService) =>
          familyService.createChild(auth.session.id, auth.user.id, payload.name),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "family",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        return yield* FamilyService.use((familyService) =>
          familyService.family(auth.session.id, auth.user.id),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "removeFamilyMember",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        yield* FamilyService.use((familyService) =>
          familyService.removeFamilyMember(auth.session.id, auth.user.id, payload.user_id),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "inviteFamilyMember",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        yield* FamilyService.use((familyService) =>
          familyService.inviteFamilyMember(auth.session.id, auth.user.id, payload.email),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "setChildEmail",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        if (auth.user.role !== "parent") {
          return yield* new HttpError(403, "Only parents can manage child accounts");
        }
        yield* FamilyService.use((familyService) =>
          familyService.setChildEmail(auth.session.id, auth.user.id, params.childId, payload.email),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "requestChildPasswordSet",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        if (auth.user.role !== "parent") {
          return yield* new HttpError(403, "Only parents can manage child accounts");
        }
        return yield* FamilyService.use((familyService) =>
          familyService.requestChildPasswordSet(auth.session.id, auth.user.id, params.childId),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "setChildPassword",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        yield* FamilyService.use((familyService) =>
          familyService.setChildPassword(
            auth.session.id,
            params.childId,
            payload.token,
            payload.password,
          ),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    ),
);

export const FamiliesAdminApiGroupLive = HttpApiBuilder.group(
  Contract,
  "familiesAdmin",
  (handlers) =>
    handlers
      .handle(
        "createFamily",
        Effect.fnUntraced(function* ({ payload }) {
          const auth = yield* CurrentSession;
          const familyResult = yield* FamilyService.use((familyService) =>
            familyService.createFamily(auth.session.id, {
              slug: payload.slug,
              name: payload.name,
            }),
          );
          const family = Array.isArray(familyResult) ? familyResult[0] : familyResult;
          if (!family) {
            return yield* new HttpError(500, "Failed to create family");
          }
          return family;
        }, adaptAdminErrors),
      )
      .handle(
        "families",
        Effect.fnUntraced(function* () {
          const auth = yield* CurrentSession;
          const rows = yield* FamilyService.use((familyService) =>
            familyService.listFamilies(auth.session.id),
          );
          return rows;
        }, adaptAdminErrors),
      )
      .handle(
        "inviteFamily",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          yield* FamilyService.use((familyService) =>
            familyService.inviteFamily(auth.session.id, params.familyId, {
              username: payload.username,
              email: payload.email,
              invitedRole: payload.invited_role,
            }),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "qrInvite",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          let familyId = params.familyId;
          if (familyId === "new") {
            const name = payload.name;
            const slug = payload.slug;
            if (!name || !slug) {
              return yield* new HttpError(
                400,
                "Name and slug are required when creating a new family",
              );
            }
            const family = yield* FamilyService.use((familyService) =>
              familyService.createQrInviteFamily(auth.session.id, {
                name,
                slug,
              }),
            );
            familyId = family.id;
          }
          const invitation = yield* FamilyService.use((familyService) =>
            familyService.createQrInvite(familyId, payload.invited_role),
          );
          const rootUrl = yield* Config.String("VITE_ROOT_URL");
          return {
            invitationId: invitation.id,
            code: invitation.code,
            url: `${rootUrl}/accept-invite?id=${invitation.id}&code=${invitation.code}`,
            expiresAt: invitation.expires_at.toISOString(),
          };
        }, adaptAdminErrors),
      )
      .handle(
        "familyInvitations",
        Effect.fnUntraced(function* (context) {
          const auth = yield* CurrentSession;
          const { params } = context;
          return (yield* FamilyService.use((familyService) =>
            familyService.listFamilyInvitations(auth.session.id, params.familyId),
          )).map((invitation) => ({
            ...invitation,
            invited_role:
              invitation.invited_role === "parent"
                ? ("parent" as const)
                : invitation.invited_role === "student"
                  ? ("student" as const)
                  : null,
          }));
        }, adaptAdminErrors),
      ),
);
