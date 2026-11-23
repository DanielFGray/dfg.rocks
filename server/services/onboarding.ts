import { Effect, Context, Layer, Option } from "effect";
import { sql } from "kysely";
import { PgRootDB } from "../db.js";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError, catchPgErrors } from "../pgErrors.js";
import { StudentProfiles } from "./studentProfiles.js";
import type { FinishOnboardingPayload, OnboardingState } from "../../shared/api/onboarding.js";

/**
 * Whether a person still has onboarding to do. Staff never do; accounts made before
 * onboarding existed were marked onboarded by the migration that added it.
 */
export const needsOnboarding = (user: { role: string; onboarded_at: Date | null }) =>
  user.onboarded_at === null && (user.role === "student" || user.role === "parent");

/** First-login onboarding for the signed-in user. Its methods run as the visitor. */
export class Onboarding extends Context.Service<Onboarding>()("dfg-rocks/onboarding", {
  make: Effect.gen(function* () {
    const rootDb = yield* PgRootDB;
    const profiles = yield* StudentProfiles;

    /** The staff invitation that made the account. Visitors cannot read invitation rows. */
    const invitationFor = (userId: string) =>
      rootDb
        .execute(
          rootDb
            .selectFrom("app_public.family_invitations as invitation")
            .leftJoin("app_public.users as inviter", "inviter.id", "invitation.invited_by")
            .select(["inviter.name as inviterName", "invitation.message"])
            .where("invitation.user_id", "=", userId)
            .where("invitation.family_id", "is", null),
        )
        .pipe(Effect.head, Effect.option, Effect.map(Option.getOrNull));

    return {
      state: Effect.fn("Onboarding.state")(function* (userId: string) {
        const db = yield* RequestDatabase;
        const user = yield* db
          .execute(
            db
              .selectFrom("app_public.users as u")
              .select(["u.name", "u.username", "u.role"])
              .select(
                sql<boolean>`coalesce(app_public.users_has_password(u), false)`.as("hasPassword"),
              )
              .where("u.id", "=", userId),
          )
          .pipe(Effect.head);
        return {
          name: user.name ?? "",
          username: user.username,
          role: user.role,
          hasPassword: user.hasPassword,
          invitation: yield* invitationFor(userId),
          profile: yield* profiles.read(userId),
        } satisfies OnboardingState;
      }),

      /**
       * Saves the answers and marks the account onboarded, all in the caller's visitor
       * transaction: a refused username saves nothing, the password included.
       */
      finish: Effect.fn("Onboarding.finish")(function* (
        userId: string,
        answers: FinishOnboardingPayload,
      ) {
        const db = yield* RequestDatabase;
        yield* db
          .execute(
            db
              .updateTable("app_public.users")
              .set({ name: answers.name.trim(), username: answers.username })
              .where("id", "=", userId),
          )
          .pipe(
            catchPgErrors,
            Effect.catchIf(
              (error) => error instanceof HttpError && error.status === 409,
              () => new HttpError({ status: 409, message: "That username is taken" }),
            ),
          );
        if (answers.password !== undefined) {
          const [row] = yield* db.execute(
            db.selectNoFrom((eb) =>
              eb
                .fn<boolean>("app_public.set_initial_password", [eb.val(answers.password)])
                .as("set"),
            ),
          );
          if (!row?.set) {
            return yield* new HttpError({
              status: 409,
              message: "Your account already has a password; change it in Settings",
            });
          }
        }
        if (answers.profile !== undefined) yield* profiles.save(userId, answers.profile);
        yield* db.execute(
          db.selectNoFrom((eb) => eb.fn<void>("app_public.finish_onboarding", []).as("finish")),
        );
      }),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide([PgRootDB.layer, StudentProfiles.layer]),
  );
}
