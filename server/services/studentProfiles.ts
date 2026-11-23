import { Effect, Context, Layer, Schema as S } from "effect";
import { RequestDatabase } from "../requestDatabase.js";
import { StudentProfile } from "../../shared/studentProfile.js";

/** A student's instruments, experience and background. Every method runs as the visitor. */
export class StudentProfiles extends Context.Service<StudentProfiles>()(
  "dfg-rocks/studentProfiles",
  {
    make: Effect.succeed({
      /** RLS decides who may read the profile; a profile nobody has filled in reads as empty. */
      read: Effect.fn("StudentProfiles.read")(function* (userId: string) {
        const db = yield* RequestDatabase;
        const [profile] = yield* db.execute(
          db
            .selectFrom("app_public.student_profiles")
            .select("background")
            .where("user_id", "=", userId),
        );
        const instruments = yield* db.execute(
          db
            .selectFrom("app_public.student_instruments")
            .select(["instrument", "experience", "other_instrument"])
            .where("user_id", "=", userId)
            .orderBy("instrument"),
        );
        return yield* S.decodeUnknownEffect(StudentProfile)({
          background: profile?.background ?? "",
          instruments,
        });
      }),

      /**
       * Replaces the profile: the background, and the instruments as a whole list, so an
       * instrument left out of the list is removed. RLS decides who may.
       */
      save: Effect.fn("StudentProfiles.save")(function* (userId: string, profile: StudentProfile) {
        const db = yield* RequestDatabase;
        const background = profile.background.trim();
        yield* db.execute(
          db
            .insertInto("app_public.student_profiles")
            .values({ user_id: userId, background })
            .onConflict((oc) => oc.column("user_id").doUpdateSet({ background })),
        );
        yield* db.execute(
          db.deleteFrom("app_public.student_instruments").where("user_id", "=", userId),
        );
        if (profile.instruments.length === 0) return;
        yield* db.execute(
          db.insertInto("app_public.student_instruments").values(
            profile.instruments.map((item) => ({
              user_id: userId,
              instrument: item.instrument,
              experience: item.experience,
              other_instrument:
                item.instrument === "other" ? item.other_instrument?.trim() || null : null,
            })),
          ),
        );
      }),
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}
