import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect, Config } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { HttpError } from "../pgErrors.js";
import { Families } from "../services/families.js";
import { Sessions } from "../services/sessions.js";
import { adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";

export const FamiliesApiGroupLive = HttpApiBuilder.group(Contract, "families", (handlers) =>
  handlers
    .handle(
      "createChild",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        if (auth.user.role !== "parent") {
          return yield* new HttpError({
            status: 403,
            message: "Only parents can create child accounts",
          });
        }
        const child = yield* Families.use((familyService) =>
          familyService
            .createChild(payload.name, payload.instruments)
            .pipe(withAuthContext(auth.session.id)),
        );
        // The owner connection can reference the child only after the visitor transaction commits.
        yield* Sessions.use((sessionService) =>
          sessionService.updateActiveStudent(auth.session.id, child.id),
        );
        return child;
      }, adaptSignedInErrors),
    )
    .handle(
      "family",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        return yield* Families.use((familyService) =>
          familyService.family(auth.user.id).pipe(withAuthContext(auth.session.id)),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "removeFamilyMember",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        yield* Families.use((familyService) =>
          familyService
            .removeFamilyMember(auth.user.id, payload.user_id)
            .pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "inviteFamilyMember",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        yield* Families.use((familyService) =>
          familyService
            .inviteFamilyMember(auth.user.id, payload.email)
            .pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "setChildEmail",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        if (auth.user.role !== "parent") {
          return yield* new HttpError({
            status: 403,
            message: "Only parents can manage child accounts",
          });
        }
        yield* Families.use((familyService) =>
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
          return yield* new HttpError({
            status: 403,
            message: "Only parents can manage child accounts",
          });
        }
        return yield* Families.use((familyService) =>
          familyService.requestChildPasswordSet(auth.session.id, auth.user.id, params.childId),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "setChildPassword",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        yield* Families.use((familyService) =>
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
          const familyResult = yield* Families.use((familyService) =>
            familyService
              .createFamily({
                slug: payload.slug,
                name: payload.name,
              })
              .pipe(withAuthContext(auth.session.id)),
          );
          const family = Array.isArray(familyResult) ? familyResult[0] : familyResult;
          if (!family) {
            return yield* new HttpError({ status: 500, message: "Failed to create family" });
          }
          return family;
        }, adaptAdminErrors),
      )
      .handle(
        "families",
        Effect.fnUntraced(function* () {
          const auth = yield* CurrentSession;
          const rows = yield* Families.use((familyService) =>
            familyService.listFamilies().pipe(withAuthContext(auth.session.id)),
          );
          return rows;
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
              return yield* new HttpError({
                status: 400,
                message: "Name and slug are required when creating a new family",
              });
            }
            const family = yield* Families.use((familyService) =>
              familyService
                .createQrInviteFamily({
                  name,
                  slug,
                })
                .pipe(withAuthContext(auth.session.id)),
            );
            familyId = family.id;
          }
          const invitation = yield* Families.use((familyService) =>
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
          return (yield* Families.use((familyService) =>
            familyService
              .listFamilyInvitations(params.familyId)
              .pipe(withAuthContext(auth.session.id)),
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
