import { Effect, Context, Layer } from "effect";
import { withAuthContext, PgRootDB } from "../db.js";
import { HttpError, catchPgErrors } from "../pgErrors.js";
import { sql } from "kysely";
import { SessionService } from "./sessionService.js";
import * as S from "effect/Schema";
import { UserRole, FamilyInviteRole } from "../../shared/schemas.js";
import { type UserRow, UserService } from "./userService.js";

/** Families, their members and invitations. */
export class FamilyService extends Context.Service<FamilyService>()("FamilyService", {
  make: Effect.gen(function* () {
    const rootDb = yield* PgRootDB;
    const invitationById = (invitationId: string) =>
      rootDb
        .selectFrom("app_public.family_invitations")
        .select(["id", "family_id", "code", "email", "invited_role", "expires_at"])
        .where("id", "=", invitationId);
    return {
      createChild: Effect.fnUntraced(function* (sessionId: string, userId: string, name: string) {
        const memberships = yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
              .selectFrom("app_public.family_memberships")
              .select("family_id")
              .where("user_id", "=", userId)
              .limit(2),
          ),
        );

        if (memberships.length === 0) {
          return yield* new HttpError(400, "You must belong to a family to add a student");
        }

        if (memberships.length > 1) {
          return yield* new HttpError(
            400,
            "You belong to multiple families. Please contact an admin to choose which family this student should join.",
          );
        }

        const familyId = memberships[0]!.family_id;

        type ChildRow = {
          id: string;
          username: string;
          name: string | null;
          role: string;
          is_verified: boolean;
        };

        const child = yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
                .selectFrom(
                  sql<ChildRow>`app_public.create_child(${familyId}, ${name})`.as("child"),
                )
                .selectAll(),
            )
            .pipe(Effect.head),
        );

        yield* SessionService.use((sessionService) =>
          sessionService.updateActiveStudent(sessionId, child.id),
        );

        return {
          id: child.id,
          username: child.username,
          name: child.name ?? "",
          role: S.decodeUnknownSync(UserRole)(child.role),
          is_verified: child.is_verified,
        };
      }),
      family: Effect.fn("family")(function* (sessionId: string, userId: string) {
        const rootDb = yield* PgRootDB;

        const result = yield* withAuthContext(
          sessionId,
          Effect.fnUntraced(function* (db) {
            const membership = yield* db
              .execute(
                db
                  .selectFrom("app_public.family_memberships as fm")
                  .innerJoin("app_public.families as f", "f.id", "fm.family_id")
                  .select([
                    "f.id",
                    "f.slug",
                    "f.name",
                    "f.description",
                    "fm.is_owner",
                    "fm.is_billing_contact",
                  ])
                  .where("fm.user_id", "=", userId),
              )
              .pipe(
                Effect.head,
                Effect.catchTags({
                  NoSuchElementError: () => new HttpError(404, "Family not found"),
                }),
              );

            const members = yield* db.execute(
              db
                .selectFrom("app_public.family_memberships as fm")
                .innerJoin("app_public.users as u", "u.id", "fm.user_id")
                .select([
                  "u.id",
                  "u.username",
                  "u.name",
                  "u.role",
                  "u.is_verified",
                  "fm.is_owner",
                  "fm.is_billing_contact",
                ])
                .where("fm.family_id", "=", membership.id),
            );

            return { membership, members };
          }),
        );

        const invitations = yield* rootDb.execute(
          rootDb
            .selectFrom("app_public.family_invitations")
            .select(["id", "email", "invited_role", "code", "expires_at"])
            .where("family_id", "=", result.membership.id),
        );

        return {
          id: result.membership.id,
          slug: result.membership.slug,
          name: result.membership.name,
          description: result.membership.description ?? null,
          members: result.members.map((m) => ({
            id: m.id,
            username: m.username,
            name: m.name ?? null,
            role: m.role,
            is_verified: m.is_verified,
            is_owner: m.is_owner,
            is_billing_contact: m.is_billing_contact,
          })),
          pendingInvitations: invitations.map((i) => ({
            id: i.id,
            email: i.email ?? null,
            invited_role: i.invited_role as string,
            code: i.code ?? null,
            expires_at: i.expires_at,
          })),
        };
      }),
      removeFamilyMember: Effect.fn("removeFamilyMember")(function* (
        sessionId: string,
        userId: string,
        targetUserId: string,
      ) {
        const membership = yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
                .selectFrom("app_public.family_memberships as fm")
                .select("fm.family_id")
                .where("fm.user_id", "=", userId)
                .where("fm.is_owner", "=", true),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () =>
                  new HttpError(403, "Only the family owner can remove members"),
              }),
            ),
        );

        yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db.selectNoFrom((eb) =>
              eb
                .fn<unknown>("app_public.remove_from_family", [
                  eb.val(membership.family_id),
                  eb.val(targetUserId),
                ])
                .as("remove_from_family"),
            ),
          ),
        ).pipe(catchPgErrors);
      }),
      inviteFamilyMember: Effect.fn("inviteFamilyMember")(function* (
        sessionId: string,
        userId: string,
        email: string,
      ) {
        const membership = yield* withAuthContext(sessionId, (db) =>
          db
            .execute(
              db
                .selectFrom("app_public.family_memberships as fm")
                .select("fm.family_id")
                .where("fm.user_id", "=", userId)
                .where("fm.is_owner", "=", true),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () =>
                  new HttpError(403, "Only the family owner can invite members"),
              }),
            ),
        );

        yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db.selectNoFrom((eb) =>
              eb
                .fn<unknown>("app_public.invite_to_family", [
                  eb.val(membership.family_id),
                  eb.val(null),
                  eb.val(email),
                  eb.val("parent"),
                ])
                .as("invite_to_family"),
            ),
          ),
        ).pipe(catchPgErrors);
      }),
      setChildEmail: Effect.fn("setChildEmail")(function* (
        sessionId: string,
        parentId: string,
        childId: string,
        email: string,
      ) {
        const rootDb = yield* PgRootDB;

        yield* rootDb
          .execute(
            rootDb.selectNoFrom((eb) =>
              eb
                .fn<void>("app_private.set_child_email", [
                  eb.val(parentId),
                  eb.val(childId),
                  eb.val(email),
                ])
                .as("set_child_email"),
            ),
          )
          .pipe(catchPgErrors);

        return { success: true as const };
      }),
      requestChildPasswordSet: Effect.fn("requestChildPasswordSet")(function* (
        sessionId: string,
        parentId: string,
        childId: string,
      ) {
        const rootDb = yield* PgRootDB;

        const rows = yield* rootDb
          .execute(
            rootDb.selectNoFrom((eb) =>
              eb
                .fn<string>("app_private.request_child_password_set", [
                  eb.val(parentId),
                  eb.val(childId),
                ])
                .as("token"),
            ),
          )
          .pipe(catchPgErrors);

        return { token: rows[0]?.token ?? "" };
      }),
      setChildPassword: Effect.fn("setChildPassword")(function* (
        sessionId: string,
        childId: string,
        token: string,
        password: string,
      ) {
        const rootDb = yield* PgRootDB;

        yield* rootDb
          .execute(
            rootDb.selectNoFrom((eb) =>
              eb
                .fn<void>("app_private.set_child_password", [
                  eb.val(childId),
                  eb.val(token),
                  eb.val(password),
                ])
                .as("set_child_password"),
            ),
          )
          .pipe(catchPgErrors);

        return { success: true as const };
      }),
      createFamily: Effect.fn("createFamily")(function* (
        sessionId: string,
        values: {
          slug: string;
          name: string;
        },
      ) {
        return yield* withAuthContext(sessionId, (trx) =>
          trx.execute(
            trx
              .selectFrom((eb) =>
                eb
                  .fn<{
                    id: string;
                    slug: string;
                    name: string;
                    description: string | null;
                    created_at: Date;
                  }>("app_public.create_family", [eb.val(values.slug), eb.val(values.name)])
                  .as("f"),
              )
              .selectAll(),
          ),
        ).pipe(catchPgErrors);
      }),
      listFamilies: Effect.fn("listFamilies")(function* (sessionId: string) {
        return yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
              .selectFrom("app_public.families")
              .select(["id", "slug", "name", "description", "created_at"])
              .orderBy("created_at", "desc"),
          ),
        );
      }),
      inviteFamily: Effect.fn("inviteFamily")(function* (
        sessionId: string,
        familyId: string,
        values: {
          username?: string;
          email?: string;
          invitedRole?: string;
        },
      ) {
        yield* withAuthContext(sessionId, (trx) =>
          trx.execute(
            trx.selectNoFrom((eb) =>
              eb
                .fn<unknown>("app_public.invite_to_family", [
                  eb.val(familyId),
                  eb.val(values.username ?? null),
                  eb.val(values.email ?? null),
                  eb.val(values.invitedRole ?? "parent"),
                ])
                .as("invite_to_family"),
            ),
          ),
        ).pipe(catchPgErrors);
      }),
      createQrInviteFamily: Effect.fn("createQrInviteFamily")(function* (
        sessionId: string,
        values: {
          name: string;
          slug: string;
        },
      ) {
        return yield* withAuthContext(sessionId, (db) =>
          db.execute(db.insertInto("app_public.families").values(values).returning(["id"])).pipe(
            Effect.head,
            Effect.catchTags({
              NoSuchElementError: () => new HttpError(500, "Failed to create family"),
            }),
            catchPgErrors,
          ),
        );
      }),
      createQrInvite: Effect.fn("createQrInvite")(function* (
        familyId: string,
        invitedRole?: string,
      ) {
        return yield* rootDb
          .execute(
            rootDb
              .selectFrom((eb) =>
                eb
                  .fn<{
                    id: string;
                    code: string;
                    expires_at: Date;
                  }>("app_private.create_qr_invite", [
                    eb.val(familyId),
                    eb.val(invitedRole ?? "parent"),
                  ])
                  .as("i"),
              )
              .select(["id", "code", "expires_at"]),
          )
          .pipe(
            catchPgErrors,
            Effect.head,
            Effect.catchTags({
              NoSuchElementError: () => new HttpError(500, "Failed to create QR invite"),
            }),
          );
      }),
      listFamilyInvitations: Effect.fn("listFamilyInvitations")(function* (
        sessionId: string,
        familyId: string,
      ) {
        return yield* withAuthContext(sessionId, (db) =>
          db.execute(
            db
              .selectFrom("app_public.family_invitations as fi")
              .innerJoin("app_public.families as f", "f.id", "fi.family_id")
              .select([
                "fi.id",
                "fi.family_id",
                "f.name as family_name",
                "fi.code",
                "fi.user_id",
                "fi.email",
                "fi.invited_role",
              ])
              .where("fi.family_id", "=", familyId),
          ),
        );
      }),
      invitation: Effect.fn("invitation")(function* (invitationId: string, code: string) {
        const invitation = yield* rootDb.execute(invitationById(invitationId)).pipe(
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

        const family = yield* rootDb
          .execute(
            rootDb
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
        return yield* rootDb.withTransaction(
          Effect.gen(function* () {
            const invitation = yield* rootDb
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
            let user: UserRow = yield* rootDb
              .execute(
                rootDb
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
              yield* rootDb.execute(
                rootDb
                  .updateTable("app_public.users")
                  .set({ role: invitedRole })
                  .where("id", "=", user.id),
              );
              user = { ...user, role: invitedRole };
            }
            yield* rootDb.execute(
              rootDb.selectNoFrom(
                sql<void>`app_private.join_family(${invitation.family_id}::uuid, ${user.id}::uuid)`.as(
                  "joined",
                ),
              ),
            );
            yield* rootDb.execute(
              rootDb.deleteFrom("app_public.family_invitations").where("id", "=", invitation.id),
            );
            return yield* UserService.use((userService) => userService.sessionFromUser(user));
          }),
        );
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
