import { Effect, Schema as S, Context, Layer } from "effect";
import { sql } from "kysely";
import { FamilyInviteRole, type Testimonial } from "../../shared/schemas.js";
import { PgRootDB } from "../db.js";
import { catchPgErrors, HttpError } from "../pgErrors.js";
import type { UserRow } from "./userService.js";
import { UserService } from "./userService.js";

export interface HomePageData {
  readonly testimonials: readonly Testimonial[];
}

export class PublicRouteService extends Context.Service<PublicRouteService>()(
  "PublicRouteService",
  {
    make: Effect.gen(function* () {
      const db = yield* PgRootDB;

      const invitationById = (invitationId: string) =>
        db
          .selectFrom("app_public.family_invitations")
          .select(["id", "family_id", "code", "email", "invited_role", "expires_at"])
          .where("id", "=", invitationId);

      return {
        invitation: Effect.fn("invitation")(function* (invitationId: string, code: string) {
          const invitation = yield* db.execute(invitationById(invitationId)).pipe(
            Effect.head,
            Effect.catchTags({
              NoSuchElementError: () => new HttpError(404, "Invitation not found"),
            }),
          );
          if (invitation.code && invitation.code !== code) {
            return yield* new HttpError(404, "Invalid invitation code");
          }
          if (invitation.expires_at && new Date(String(invitation.expires_at)) < new Date()) {
            return yield* new HttpError(400, "This invitation has expired");
          }

          const family = yield* db
            .execute(
              db
                .selectFrom("app_public.families")
                .select(["id", "slug", "name", "description", "created_at"])
                .where("id", "=", invitation.family_id),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(404, "Invitation family not found"),
              }),
            );
          return {
            ...family,
            email: invitation.email ?? "",
            invited_role: invitation.invited_role
              ? S.decodeUnknownSync(FamilyInviteRole)(invitation.invited_role)
              : undefined,
          };
        }),

        acceptInvitation: Effect.fn("acceptInvitation")(function* (values: {
          invitationId: string;
          code?: string;
          username: string;
          password: string;
          name: string;
          email?: string;
        }) {
          return yield* db.withTransaction(
            Effect.gen(function* () {
              const invitation = yield* db
                .execute(invitationById(values.invitationId).forUpdate())
                .pipe(
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(400, "Invitation not found"),
                  }),
                );
              if (invitation.code && invitation.code !== (values.code ?? "")) {
                return yield* new HttpError(400, "Invalid invitation code");
              }
              if (invitation.expires_at && new Date(String(invitation.expires_at)) < new Date()) {
                return yield* new HttpError(400, "This invitation has expired");
              }
              let user: UserRow = yield* db
                .execute(
                  db
                    .selectFrom(
                      sql<UserRow>`app_private.really_create_user(
                ${values.username}::citext,
                ${values.name},
                null,
                false,
                ${invitation.email || values.email || null},
                ${values.password}
              )`.as("u"),
                    )
                    .selectAll(),
                )
                .pipe(
                  catchPgErrors,
                  Effect.head,
                  Effect.catchTags({
                    NoSuchElementError: () => new HttpError(500, "Failed to create user"),
                  }),
                );
              const invitedRole = invitation.invited_role;
              if (invitedRole === "parent" || invitedRole === "student") {
                yield* db.execute(
                  db
                    .updateTable("app_public.users")
                    .set({ role: invitedRole })
                    .where("id", "=", user.id),
                );
                user = { ...user, role: invitedRole };
              }
              yield* db.execute(
                db.selectNoFrom(
                  sql<void>`app_private.join_family(${invitation.family_id}::uuid, ${user.id}::uuid)`.as(
                    "joined",
                  ),
                ),
              );
              yield* db.execute(
                db.deleteFrom("app_public.family_invitations").where("id", "=", invitation.id),
              );
              return yield* UserService.use((userService) => userService.sessionFromUser(user));
            }),
          );
        }),
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
