import { describe, expect, it } from "vitest";
import { calculateLessonCancellationPolicy } from "../services/lessonPolicy.js";

const settings = {
  cancellation_window_hours: 24,
  late_cancel_charge_percent: 50,
};
const now = new Date("2026-07-14T12:00:00.000Z");

describe("lesson cancellation policy", () => {
  it("refunds a single-booking deposit exactly at the cancellation threshold", () => {
    expect(
      calculateLessonCancellationPolicy({
        billingModel: "single_booking",
        scheduledAt: new Date("2026-07-15T12:00:00.000Z"),
        rateCents: 9000,
        heldDepositCents: 3000,
        settings,
        now,
      }),
    ).toEqual({
      billing_model: "single_booking",
      hours_until_lesson: 24,
      is_late: false,
      deposit_outcome: "refunded",
      fee_outcome: "none",
      amount_cents: 3000,
    });
  });

  it("captures a single-booking deposit one millisecond inside the window", () => {
    const result = calculateLessonCancellationPolicy({
      billingModel: "single_booking",
      scheduledAt: new Date(now.getTime() + 24 * 60 * 60 * 1000 - 1),
      rateCents: 9000,
      heldDepositCents: 3000,
      settings,
      now,
    });

    expect(result.is_late).toBe(true);
    expect(result.deposit_outcome).toBe("captured");
    expect(result.amount_cents).toBe(3000);
  });

  it("records the configured late fee for monthly prepaid without a deposit outcome", () => {
    expect(
      calculateLessonCancellationPolicy({
        billingModel: "monthly_prepaid",
        scheduledAt: new Date("2026-07-15T11:59:59.000Z"),
        rateCents: 8501,
        heldDepositCents: null,
        settings,
        now,
      }),
    ).toMatchObject({
      billing_model: "monthly_prepaid",
      is_late: true,
      deposit_outcome: "none",
      fee_outcome: "recorded",
      amount_cents: 4251,
    });
  });

  it("has no early monthly-prepaid cancellation charge", () => {
    expect(
      calculateLessonCancellationPolicy({
        billingModel: "monthly_prepaid",
        scheduledAt: new Date("2026-07-16T12:00:00.000Z"),
        rateCents: 8500,
        heldDepositCents: null,
        settings,
        now,
      }),
    ).toMatchObject({
      is_late: false,
      deposit_outcome: "none",
      fee_outcome: "none",
      amount_cents: 0,
    });
  });
});
