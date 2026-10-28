import { Effect, Schema as S } from "effect";
import { sql } from "kysely";
import { serializeTestimonial } from "../../shared/responseMappers.js";
import { FamilyInviteRole, type Testimonial } from "../../shared/schemas.js";
import { env } from "../assertEnv.js";
import { PgRootDB } from "../db.js";
import { catchPgErrors, HttpError } from "../pgErrors.js";
import type { UserRow } from "./userService.js";
import { UserService } from "./userService.js";

export interface HomePageData {
  readonly testimonials: readonly Testimonial[];
}

export class PublicRouteService extends Effect.Service<PublicRouteService>()("PublicRouteService", {
  accessors: true,
  effect: Effect.gen(function* () {
    const db = yield* PgRootDB;

    const invitationById = (invitationId: string) =>
      db
        .selectFrom("app_public.family_invitations")
        .select(["id", "family_id", "code", "email", "invited_role", "expires_at"])
        .where("id", "=", invitationId);

    return {
      homePageData: Effect.fn("homePageData")(function* () {
        const rows = yield* db
          .selectFrom("app_public.testimonials as t")
          .innerJoin("app_public.users as u", "u.id", "t.user_id")
          .select([
            "t.id",
            "t.user_id",
            "t.body",
            "t.is_approved",
            "t.created_at",
            "t.updated_at",
            "u.username",
            "u.name",
            "u.role",
          ])
          .where("u.role", "!=", "admin")
          .where("t.is_approved", "=", true)
          .orderBy("t.updated_at", "desc")
          .limit(6);

        return {
          testimonials: rows.map(serializeTestimonial),
        } satisfies HomePageData;
      }),

      submitContact: Effect.fn("submitContact")(function* (
        values: {
          name: string;
          email: string;
          phone?: string;
          instrument: string;
          format: string;
          message?: string;
        },
        geo?: {
          ip: string;
          country: string;
          region: string;
          city: string;
        },
      ) {
        // One transaction: the submission and its notification email exist together or not at all.
        yield* db.withTransaction(
          Effect.gen(function* () {
            yield* db.insertInto("app_public.contact_submissions").values({
              name: values.name,
              email: values.email,
              phone: values.phone ?? null,
              instrument: values.instrument,
              format: values.format,
              message: values.message ?? "",
              ip_address: geo?.ip ?? null,
              location_country: geo?.country || null,
              location_region: geo?.region || null,
              location_city: geo?.city || null,
            });
            yield* db.selectNoFrom((eb) =>
              eb
                .fn<unknown>("graphile_worker.add_job", [
                  eb.val("send_email"),
                  sql`${JSON.stringify({
                    options: {
                      to: env.ADMIN_EMAIL,
                      subject: `New contact: ${values.name} (${values.instrument})`,
                    },
                    template: "contact_submission.mjml",
                    variables: {
                      name: values.name,
                      email: values.email,
                      phone: values.phone ?? "",
                      instrument: values.instrument,
                      format: values.format,
                      message: values.message ?? "",
                    },
                  })}::json`,
                ])
                .as("add_job"),
            );
          }),
        );
      }),

      linkOrRegisterOAuthUser: Effect.fn("linkOrRegisterOAuthUser")(function* (values: {
        service: "google" | "apple";
        identifier: string;
        profile: unknown;
        tokens: unknown;
      }) {
        return yield* db
          .selectFrom(
            sql<UserRow>`app_private.link_or_register_user(
            null,
            ${values.service},
            ${values.identifier},
            ${JSON.stringify(values.profile)}::json,
            ${JSON.stringify(values.tokens)}::json
          )`.as("u"),
          )
          .selectAll()
          .pipe(
            catchPgErrors,
            Effect.head,
            Effect.catchTags({
              NoSuchElementException: () => new HttpError(500, "Failed to link account"),
            }),
          );
      }),

      verifyEmail: Effect.fn("verifyEmail")(function* (token: string) {
        const secret = yield* db
          .selectFrom("app_private.user_email_secrets")
          .select("user_email_id")
          .where("verification_token", "=", token)
          .pipe(
            Effect.head,
            Effect.catchTags({
              NoSuchElementException: () =>
                new HttpError(400, "Invalid or expired verification link"),
            }),
          );
        yield* db
          .selectNoFrom((eb) =>
            eb
              .fn<unknown>("app_public.verify_email", [
                sql`${secret.user_email_id}::uuid`,
                eb.val(token),
              ])
              .as("verify_email"),
          )
          .pipe(catchPgErrors);
      }),

      invitation: Effect.fn("invitation")(function* (invitationId: string, code: string) {
        const invitation = yield* invitationById(invitationId).pipe(
          Effect.head,
          Effect.catchTags({
            NoSuchElementException: () => new HttpError(404, "Invitation not found"),
          }),
        );
        if (invitation.code && invitation.code !== code) {
          return yield* new HttpError(404, "Invalid invitation code");
        }
        if (invitation.expires_at && new Date(String(invitation.expires_at)) < new Date()) {
          return yield* new HttpError(400, "This invitation has expired");
        }

        const family = yield* db
          .selectFrom("app_public.families")
          .select(["id", "slug", "name", "description", "created_at"])
          .where("id", "=", invitation.family_id)
          .pipe(
            Effect.head,
            Effect.catchTags({
              NoSuchElementException: () => new HttpError(404, "Invitation family not found"),
            }),
          );
        return {
          ...family,
          email: invitation.email ?? "",
          invited_role: invitation.invited_role
            ? S.decodeUnknownSync(FamilyInviteRole)(invitation.invited_role)
            : undefined,
          created_at: family.created_at.toISOString(),
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
            const invitation = yield* invitationById(values.invitationId)
              .forUpdate()
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementException: () => new HttpError(400, "Invitation not found"),
                }),
              );
            if (invitation.code && invitation.code !== (values.code ?? "")) {
              return yield* new HttpError(400, "Invalid invitation code");
            }
            if (invitation.expires_at && new Date(String(invitation.expires_at)) < new Date()) {
              return yield* new HttpError(400, "This invitation has expired");
            }
            let user: UserRow = yield* db
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
              .selectAll()
              .pipe(
                catchPgErrors,
                Effect.head,
                Effect.catchTags({
                  NoSuchElementException: () => new HttpError(500, "Failed to create user"),
                }),
              );
            const invitedRole = invitation.invited_role;
            if (invitedRole === "parent" || invitedRole === "student") {
              yield* db
                .updateTable("app_public.users")
                .set({ role: invitedRole })
                .where("id", "=", user.id);
              user = { ...user, role: invitedRole };
            }
            yield* db
              .insertInto("app_public.family_memberships")
              .values({ family_id: invitation.family_id, user_id: user.id })
              .onConflict((oc) => oc.doNothing());
            yield* db.deleteFrom("app_public.family_invitations").where("id", "=", invitation.id);
            return yield* UserService.sessionFromUser(user);
          }),
        );
      }),
    };
  }),
}) {}
