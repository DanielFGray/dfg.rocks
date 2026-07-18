import { describe, expect, it } from "vitest";
import { BUSINESS_TIME_ZONE, todayRange, weekRange } from "../../shared/dateRanges.js";

function iso(range: ReturnType<typeof todayRange>) {
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
  };
}

describe("Central-Time date ranges", () => {
  it("uses one explicit canonical business timezone", () => {
    expect(BUSINESS_TIME_ZONE).toBe("America/Chicago");
  });

  it("returns an ordinary local day as a half-open UTC range", () => {
    expect(iso(todayRange(new Date("2026-01-15T18:00:00.000Z")))).toEqual({
      from: "2026-01-15T06:00:00.000Z",
      to: "2026-01-16T06:00:00.000Z",
    });
  });

  it("returns a 23-hour day across spring-forward", () => {
    const range = todayRange(new Date("2026-03-08T12:00:00.000Z"));

    expect(iso(range)).toEqual({
      from: "2026-03-08T06:00:00.000Z",
      to: "2026-03-09T05:00:00.000Z",
    });
    expect(range.to.getTime() - range.from.getTime()).toBe(23 * 60 * 60 * 1_000);
  });

  it("returns a 25-hour day across fall-back", () => {
    const range = todayRange(new Date("2026-11-01T12:00:00.000Z"));

    expect(iso(range)).toEqual({
      from: "2026-11-01T05:00:00.000Z",
      to: "2026-11-02T06:00:00.000Z",
    });
    expect(range.to.getTime() - range.from.getTime()).toBe(25 * 60 * 60 * 1_000);
  });

  it("uses the previous local day when the UTC date is already tomorrow", () => {
    expect(iso(todayRange(new Date("2026-01-16T03:00:00.000Z")))).toEqual({
      from: "2026-01-15T06:00:00.000Z",
      to: "2026-01-16T06:00:00.000Z",
    });
  });

  it("uses Monday boundaries and the offsets in effect at each boundary", () => {
    const range = weekRange(new Date("2026-03-08T12:00:00.000Z"));

    expect(iso(range)).toEqual({
      from: "2026-03-02T06:00:00.000Z",
      to: "2026-03-09T05:00:00.000Z",
    });
    expect(range.to.getTime() - range.from.getTime()).toBe(167 * 60 * 60 * 1_000);
  });
});
