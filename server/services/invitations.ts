import { Config, Context, Effect, Layer, Option, Schema } from "effect";
import { sql } from "kysely";
import { addJob, PgRootDB } from "../db.js";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError, catchPgErrors } from "../pgErrors.js";
import type { FamilyInviteRole } from "../../shared/schemas.js";
import type { InviteAccountResult } from "../../shared/api/invitations.js";
import { type UserRow, Users } from "./users.js";

/**
 * Invitations and their email. An account invitation (a family_invitations row with no family)
 * belongs to an account staff created; following its link verifies the address and logs in. A
 * row with a family offers to join that family. Design: docs/design/account-invitations.md.
 */
export class Invitations extends Context.Service<Invitations>()("dfg-rocks/invitations", {
  make: Effect.gen(function* () {
    const users = yield* Users;
    const rootDb = yield* PgRootDB;
    const rootUrl = Config.NonEmptyString("VITE_ROOT_URL");

    /** An account invitation's link and text, or None once the account is claimed. */
    const accountInvitationMail = (id: string) =>
      rootDb
        .execute(
          rootDb
            .selectFrom("app_public.family_invitations as invitation")
            .innerJoin("app_public.users as invitee", "invitee.id", "invitation.user_id")
            .innerJoin("app_public.user_emails as address", "address.user_id", "invitee.id")
            .innerJoin(
              "app_private.user_email_secrets as secret",
              "secret.user_email_id",
              "address.id",
            )
            .leftJoin("app_public.users as inviter", "inviter.id", "invitation.invited_by")
            .select([
              "address.email",
              "secret.verification_token as token",
              "invitee.name as invitee_name",
              "inviter.name as inviter_name",
              "invitation.message",
            ])
            .where("invitation.id", "=", id)
            .where("invitation.family_id", "is", null)
            .where("invitee.is_verified", "=", false)
            .where("address.is_verified", "=", false)
            .where("secret.verification_token", "is not", null),
        )
        .pipe(Effect.head, Effect.option);

    const sendFamilyInvitation = Effect.fnUntraced(function* (id: string) {
      const invitation = yield* rootDb
        .execute(
          rootDb
            .selectFrom("app_public.family_invitations as invitation")
            .leftJoinLateral(
              (eb) =>
                eb
                  .selectFrom("app_public.user_emails")
                  .select("email")
                  .whereRef("user_id", "=", "invitation.user_id")
                  .orderBy("is_primary", "desc")
                  .orderBy("is_verified", "desc")
                  .limit(1)
                  .as("address"),
              (join) => join.onTrue(),
            )
            .select((eb) => [
              "invitation.code",
              eb.fn.coalesce("invitation.email", "address.email").as("email"),
            ])
            .where("invitation.id", "=", id),
        )
        .pipe(Effect.head, Effect.option);
      if (Option.isNone(invitation) || !invitation.value.email) return;
      const query = new URLSearchParams({ id });
      if (invitation.value.code) query.set("code", invitation.value.code);
      yield* addJob(rootDb, "send_email", {
        options: { to: invitation.value.email, subject: "You've been invited to DFG Portal" },
        template: "invitation.mjml",
        variables: { inviteLink: `${yield* rootUrl}/accept-invite?${query}` },
      });
    });

    return {
      /** The worker task the family_invitations insert trigger and resends queue. */
      sendInvitation: Effect.fn("Invitations.sendInvitation")(function* ({
        id,
      }: typeof SendInvitation.Type) {
        const isAccount = yield* rootDb
          .execute(
            rootDb
              .selectFrom("app_public.family_invitations")
              .select("id")
              .where("id", "=", id)
              .where("family_id", "is", null),
          )
          .pipe(Effect.map((rows) => rows.length > 0));
        if (!isAccount) return yield* sendFamilyInvitation(id);
        const mail = yield* accountInvitationMail(id);
        if (Option.isNone(mail)) return yield* Effect.logInfo("Invited account already claimed");
        const { email, token, invitee_name, inviter_name, message } = mail.value;
        const link = new URL("/invite", yield* rootUrl);
        link.search = new URLSearchParams({ id, token: token ?? "" }).toString();
        yield* addJob(rootDb, "send_email", {
          options: {
            to: email,
            subject: inviter_name
              ? `${inviter_name} invited you to DFG Portal`
              : "You're invited to DFG Portal",
          },
          template: "account_invitation.mjml",
          variables: {
            inviteeName: invitee_name ?? "",
            inviterName: inviter_name ?? "",
            message: message ?? "",
            loginLink: link.toString(),
          },
        });
      }),

      /**
       * Creates the account and queues its email, or names the account that already holds the
       * address. The SQL function refuses that address too, for a race between two staff.
       */
      inviteAccount: Effect.fn("Invitations.inviteAccount")(function* (values: {
        name: string;
        email: string;
        role: FamilyInviteRole;
        familyId?: string;
        message?: string;
      }) {
        const db = yield* RequestDatabase;
        const holder = yield* db
          .execute(
            db
              .selectFrom("app_public.user_emails as address")
              .innerJoin("app_public.users as u", "u.id", "address.user_id")
              .select(["u.id", "u.username", "u.name"])
              .where("address.email", "=", sql<string>`${values.email.trim()}::citext`)
              .limit(1),
          )
          .pipe(Effect.head, Effect.option);
        if (Option.isSome(holder)) {
          return {
            _tag: "EmailTaken",
            person: { ...holder.value, name: holder.value.name ?? null },
          } satisfies InviteAccountResult;
        }
        const person = yield* db
          .execute(
            db
              .selectFrom(
                sql<{
                  id: string;
                  username: string;
                  name: string | null;
                }>`app_public.invite_account(${values.name}, ${values.email.trim()}::citext, ${values.role}::app_public.user_role, ${values.familyId ?? null}::uuid, ${values.message ?? null})`.as(
                  "u",
                ),
              )
              .select(["u.id", "u.username", "u.name"]),
          )
          .pipe(
            catchPgErrors,
            Effect.head,
            Effect.catchTags({
              NoSuchElementError: () =>
                new HttpError({ status: 500, message: "Could not create the account" }),
            }),
          );
        return { _tag: "Invited", person } satisfies InviteAccountResult;
      }),

      /** Invited accounts whose owner has not followed the link, newest first. */
      pendingInvitations: Effect.fn("Invitations.pendingInvitations")(function* () {
        const db = yield* RequestDatabase;
        return yield* db.execute(
          db
            .selectFrom("app_public.family_invitations as invitation")
            .innerJoin("app_public.users as invitee", "invitee.id", "invitation.user_id")
            .leftJoin("app_public.users as inviter", "inviter.id", "invitation.invited_by")
            .select((eb) => [
              "invitation.id",
              "invitee.id as user_id",
              "invitee.name",
              "invitee.username",
              "inviter.name as invited_by_name",
              "invitation.created_at",
              "invitation.expires_at",
              eb
                .selectFrom("app_public.user_emails")
                .select("email")
                .whereRef("user_id", "=", "invitee.id")
                .orderBy("created_at")
                .limit(1)
                .as("email"),
            ])
            .where("invitation.family_id", "is", null)
            .where("invitee.is_verified", "=", false)
            .orderBy("invitation.created_at", "desc"),
        );
      }),

      resendInvitation: Effect.fn("Invitations.resendInvitation")(function* (id: string) {
        const db = yield* RequestDatabase;
        yield* db
          .execute(
            db.selectNoFrom((eb) =>
              eb.fn<unknown>("app_public.resend_account_invitation", [eb.val(id)]).as("resend"),
            ),
          )
          .pipe(catchPgErrors);
      }),

      /** What the invitation page shows before the person continues. Uses nothing up. */
      preview: Effect.fn("Invitations.preview")(function* (id: string, token: string) {
        const mail = yield* accountInvitationMail(id);
        if (Option.isNone(mail) || mail.value.token !== token) return Option.none();
        return Option.some({
          name: mail.value.invitee_name,
          inviterName: mail.value.inviter_name,
          message: mail.value.message,
        });
      }),

      /** Verifies the invited address and starts a session for its account. */
      claim: Effect.fn("Invitations.claim")(function* (id: string, token: string) {
        return yield* rootDb.withTransaction(
          Effect.gen(function* () {
            const user = yield* rootDb
              .execute(
                rootDb
                  .selectFrom(
                    sql<UserRow>`app_private.claim_account_invitation(${id}::uuid, ${token})`.as(
                      "u",
                    ),
                  )
                  .selectAll()
                  .where("u.id", "is not", null),
              )
              .pipe(
                catchPgErrors,
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () =>
                    new HttpError({
                      status: 400,
                      message: "This invitation link is invalid, expired, or already used",
                    }),
                }),
              );
            return yield* users.sessionFromUser(user);
          }),
        );
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(Users.layer),
    Layer.provide(PgRootDB.layer),
  );
}

export const SendInvitation = Schema.Struct({ id: Schema.String });
