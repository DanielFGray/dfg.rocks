import * as S from "effect/Schema";
import { WorkingHours as WorkingHoursSchema, type WorkingHours } from "./schemas.js";

export const defaultWorkingHours: WorkingHours = {
  0: null,
  1: { start: "09:00", end: "20:00" },
  2: { start: "09:00", end: "20:00" },
  3: { start: "09:00", end: "20:00" },
  4: { start: "09:00", end: "20:00" },
  5: { start: "09:00", end: "20:00" },
  6: { start: "10:00", end: "14:00" },
};

export function decodeWorkingHoursValue(value: unknown, fallback: unknown): WorkingHours {
  const decoded = S.decodeUnknownSync(WorkingHoursSchema)(value ?? fallback);
  return {
    0: decoded[0] ?? null,
    1: decoded[1] ?? null,
    2: decoded[2] ?? null,
    3: decoded[3] ?? null,
    4: decoded[4] ?? null,
    5: decoded[5] ?? null,
    6: decoded[6] ?? null,
  };
}
