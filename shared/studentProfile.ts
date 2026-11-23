/** The answers a student profile holds. migrations/current/2-student-profiles.sql checks the same values. */
import { Schema as S } from "effect";
import { ContactInstrument } from "./contactOptions.js";

export const experienceValues = [
  "none",
  "under_1_year",
  "1_to_3_years",
  "3_to_5_years",
  "5_to_10_years",
  "over_10_years",
] as const;

export const Experience = S.Literals(experienceValues);
export type Experience = typeof Experience.Type;

export const experienceLabels: Record<Experience, string> = {
  none: "Never played",
  under_1_year: "Less than a year",
  "1_to_3_years": "1–3 years",
  "3_to_5_years": "3–5 years",
  "5_to_10_years": "5–10 years",
  over_10_years: "More than 10 years",
};

export const StudentInstrument = S.Struct({
  instrument: ContactInstrument,
  experience: Experience,
  /** The instrument's name when `instrument` is "other". */
  other_instrument: S.optional(S.NullOr(S.String.pipe(S.check(S.isMaxLength(100))))),
});
export type StudentInstrument = typeof StudentInstrument.Type;

export const StudentProfile = S.Struct({
  background: S.String.pipe(S.check(S.isMaxLength(4000))),
  instruments: S.Array(StudentInstrument),
});
export type StudentProfile = typeof StudentProfile.Type;
