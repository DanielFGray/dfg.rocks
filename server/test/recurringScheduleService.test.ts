import { describe, expect, it } from "vitest";
import {
  isFirstOfMonth,
  isIsoDate,
  validateRecurringSchedule,
} from "../services/recurringSchedule.js";

const validSchedule = {
  studentRateId: "rate-1",
  dayOfWeek: 2,
  localStartTime: "16:30",
  timezone: "America/Chicago",
  startsOn: "2026-07-01",
  endsOn: null,
  active: true,
};

describe("recurring schedule validation", () => {
  it("accepts valid dates, leap days, and first-of-month billing dates", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isFirstOfMonth("2026-07-01")).toBe(true);
    expect(validateRecurringSchedule(validSchedule)).toEqual([]);
  });

  it("rejects normalized or impossible calendar dates", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-7-01")).toBe(false);
    expect(isFirstOfMonth("2026-07-02")).toBe(false);
  });

  it("validates ISO weekday, local time, timezone, and schedule range", () => {
    const errors = validateRecurringSchedule({
      ...validSchedule,
      dayOfWeek: 0,
      localStartTime: "24:15",
      timezone: "Mars/Olympus",
      startsOn: "2026-07-10",
      endsOn: "2026-07-09",
    });
    expect(errors).toEqual([
      "day_of_week must be an ISO weekday from 1 through 7",
      "local_start_time must be HH:mm or HH:mm:ss",
      "timezone must be a valid IANA time zone",
      "ends_on must not be before starts_on",
    ]);
  });
});
