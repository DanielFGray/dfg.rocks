import { describe, expect, it } from "vitest";
import {
  assertCents,
  assertNonNegativeCents,
  assertPositiveCents,
  roundCents,
  calculateDiscount,
  calculateLineTax,
  getMonthlyOccurrenceDates,
  selectEffectiveRate,
  calculateDepositAmount,
  resolveBookingOutcome,
  allocatePayment,
} from "../services/billingCalculation.js";
import type {
  BillForAllocation,
  DiscountConfig,
  EffectiveDatedRate,
  TaxRateConfig,
} from "../services/billingCalculation.js";

// ---------------------------------------------------------------------------
// Cent validation
// ---------------------------------------------------------------------------

describe("cent validation", () => {
  it("accepts integer cents", () => {
    expect(assertCents(0)).toBe(0);
    expect(assertCents(1)).toBe(1);
    expect(assertCents(9999)).toBe(9999);
  });

  it("rejects non-integer values", () => {
    expect(() => assertCents(10.5)).toThrow("integer number of cents");
    expect(() => assertCents(NaN)).toThrow("integer number of cents");
    expect(() => assertCents(Infinity)).toThrow("integer number of cents");
  });

  it("assertNonNegativeCents rejects negative", () => {
    expect(() => assertNonNegativeCents(-1)).toThrow("non-negative");
    expect(assertNonNegativeCents(0)).toBe(0);
  });

  it("assertPositiveCents rejects zero and negative", () => {
    expect(() => assertPositiveCents(0)).toThrow("positive");
    expect(() => assertPositiveCents(-5)).toThrow("positive");
    expect(assertPositiveCents(1)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Half-up rounding
// ---------------------------------------------------------------------------

describe("roundCents", () => {
  it("rounds half up", () => {
    expect(roundCents(1.4)).toBe(1);
    expect(roundCents(1.5)).toBe(2);
    expect(roundCents(1.6)).toBe(2);
    expect(roundCents(2.5)).toBe(3);
  });

  it("preserves exact integers", () => {
    expect(roundCents(100)).toBe(100);
    expect(roundCents(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Discount calculation
// ---------------------------------------------------------------------------

describe("calculateDiscount", () => {
  const tuitionItems = [
    { amountCents: 10000, category: "tuition" as const },
    { amountCents: 8000, category: "tuition" as const },
  ];
  const feeItems = [{ amountCents: 5000, category: "fees" as const }];
  const allItems = [...tuitionItems, ...feeItems];

  it("applies a fixed discount unconditionally", () => {
    const discounts: DiscountConfig[] = [
      { discountType: "fixed", discountValue: 2000, appliesTo: "all" },
    ];
    expect(calculateDiscount(allItems, discounts)).toBe(2000);
  });

  it("applies a percentage discount to the matching category", () => {
    const discounts: DiscountConfig[] = [
      { discountType: "percentage", discountValue: 10, appliesTo: "tuition" },
    ];
    // 10% of 18000 = 1800
    expect(calculateDiscount(allItems, discounts)).toBe(1800);
  });

  it("applies a percentage discount to fees only", () => {
    const discounts: DiscountConfig[] = [
      { discountType: "percentage", discountValue: 50, appliesTo: "fees" },
    ];
    // 50% of 5000 = 2500
    expect(calculateDiscount(allItems, discounts)).toBe(2500);
  });

  it("applies percentage to all categories when appliesTo is all", () => {
    const discounts: DiscountConfig[] = [
      { discountType: "percentage", discountValue: 15, appliesTo: "all" },
    ];
    // 15% of 23000 = 3450
    expect(calculateDiscount(allItems, discounts)).toBe(3450);
  });

  it("stacks multiple discounts", () => {
    const discounts: DiscountConfig[] = [
      { discountType: "fixed", discountValue: 1000, appliesTo: "all" },
      { discountType: "percentage", discountValue: 10, appliesTo: "tuition" },
    ];
    // fixed 1000 + 10% of 18000 = 1000 + 1800 = 2800
    expect(calculateDiscount(allItems, discounts)).toBe(2800);
  });

  it("rounds percentage discounts to nearest cent", () => {
    const items = [{ amountCents: 333, category: "tuition" as const }];
    const discounts: DiscountConfig[] = [
      { discountType: "percentage", discountValue: 33, appliesTo: "tuition" },
    ];
    // 33% of 333 = 109.89 -> round to 110
    expect(calculateDiscount(items, discounts)).toBe(110);
  });

  it("returns zero for no discounts", () => {
    expect(calculateDiscount(allItems, [])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Line-level tax
// ---------------------------------------------------------------------------

describe("calculateLineTax", () => {
  const tuitionItems = [
    { amountCents: 10000, category: "tuition" as const },
  ];
  const feeItems = [{ amountCents: 5000, category: "fees" as const }];
  const allItems = [...tuitionItems, ...feeItems];

  it("applies tax rate to matching category", () => {
    const rates: TaxRateConfig[] = [
      { ratePercent: 8.25, appliesTo: "tuition" },
    ];
    // 8.25% of 10000 = 825
    expect(calculateLineTax(allItems, rates)).toBe(825);
  });

  it("applies tax rate to all categories", () => {
    const rates: TaxRateConfig[] = [
      { ratePercent: 5, appliesTo: "all" },
    ];
    // 5% of 15000 = 750
    expect(calculateLineTax(allItems, rates)).toBe(750);
  });

  it("combines multiple tax rates", () => {
    const rates: TaxRateConfig[] = [
      { ratePercent: 8.25, appliesTo: "tuition" },
      { ratePercent: 3, appliesTo: "fees" },
    ];
    // 8.25% of 10000 = 825 + 3% of 5000 = 150 => 975
    expect(calculateLineTax(allItems, rates)).toBe(975);
  });

  it("rounds to nearest cent", () => {
    const items = [{ amountCents: 333, category: "tuition" as const }];
    const rates: TaxRateConfig[] = [
      { ratePercent: 8.25, appliesTo: "tuition" },
    ];
    // 8.25% of 333 = 27.4725 -> 27
    expect(calculateLineTax(items, rates)).toBe(27);
  });

  it("rounds each taxable line independently", () => {
    const rates: TaxRateConfig[] = [{ ratePercent: 8.25, appliesTo: "tuition" }];
    expect(
      calculateLineTax(
        [
          { amountCents: 7, category: "tuition" },
          { amountCents: 7, category: "tuition" },
        ],
        rates,
      ),
    ).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Monthly occurrence dates
// ---------------------------------------------------------------------------

describe("getMonthlyOccurrenceDates", () => {
  it("returns all Tuesdays in July 2026 for a Tuesday schedule", () => {
    const dates = getMonthlyOccurrenceDates({
      dayOfWeek: 2,
      timezone: "America/Chicago",
      startsOn: "2026-01-01",
      endsOn: null,
      billingMonth: "2026-07-01",
    });
    expect(dates).toEqual([
      "2026-07-07",
      "2026-07-14",
      "2026-07-21",
      "2026-07-28",
    ]);
  });

  it("returns Mondays in July 2026", () => {
    const dates = getMonthlyOccurrenceDates({
      dayOfWeek: 1,
      timezone: "America/Chicago",
      startsOn: "2026-01-01",
      endsOn: null,
      billingMonth: "2026-07-01",
    });
    expect(dates).toEqual([
      "2026-07-06",
      "2026-07-13",
      "2026-07-20",
      "2026-07-27",
    ]);
  });

  it("returns Sundays in July 2026", () => {
    const dates = getMonthlyOccurrenceDates({
      dayOfWeek: 7,
      timezone: "America/Chicago",
      startsOn: "2026-01-01",
      endsOn: null,
      billingMonth: "2026-07-01",
    });
    expect(dates).toEqual([
      "2026-07-05",
      "2026-07-12",
      "2026-07-19",
      "2026-07-26",
    ]);
  });

  it("filters by schedule startsOn", () => {
    const dates = getMonthlyOccurrenceDates({
      dayOfWeek: 2,
      timezone: "America/Chicago",
      startsOn: "2026-07-14",
      endsOn: null,
      billingMonth: "2026-07-01",
    });
    expect(dates).toEqual(["2026-07-14", "2026-07-21", "2026-07-28"]);
  });

  it("filters by schedule endsOn", () => {
    const dates = getMonthlyOccurrenceDates({
      dayOfWeek: 2,
      timezone: "America/Chicago",
      startsOn: "2026-01-01",
      endsOn: "2026-07-20",
      billingMonth: "2026-07-01",
    });
    expect(dates).toEqual(["2026-07-07", "2026-07-14"]);
  });

  it("returns empty when no occurrences fall in the month", () => {
    const dates = getMonthlyOccurrenceDates({
      dayOfWeek: 6,
      timezone: "America/Chicago",
      startsOn: "2027-01-01",
      endsOn: null,
      billingMonth: "2026-07-01",
    });
    expect(dates).toEqual([]);
  });

  it("handles February in a non-leap year", () => {
    const dates = getMonthlyOccurrenceDates({
      dayOfWeek: 4,
      timezone: "America/Chicago",
      startsOn: "2026-01-01",
      endsOn: null,
      billingMonth: "2026-02-01",
    });
    // Thursdays in Feb 2026: 5, 12, 19, 26
    expect(dates).toEqual([
      "2026-02-05",
      "2026-02-12",
      "2026-02-19",
      "2026-02-26",
    ]);
  });

  it("handles a month with 5 occurrences", () => {
    // January 2026 starts on Thursday, so Thursdays: 1, 8, 15, 22, 29
    const dates = getMonthlyOccurrenceDates({
      dayOfWeek: 4,
      timezone: "America/Chicago",
      startsOn: "2026-01-01",
      endsOn: null,
      billingMonth: "2026-01-01",
    });
    expect(dates).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-01-15",
      "2026-01-22",
      "2026-01-29",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Effective-dated rate selection
// ---------------------------------------------------------------------------

describe("selectEffectiveRate", () => {
  const rates: EffectiveDatedRate[] = [
    {
      rateCents: 7000,
      lessonDurationMinutes: 30,
      effectiveFrom: "2026-01-01",
      effectiveUntil: "2026-06-30",
    },
    {
      rateCents: 7500,
      lessonDurationMinutes: 30,
      effectiveFrom: "2026-07-01",
      effectiveUntil: null,
    },
  ];

  it("selects the rate effective on a given date", () => {
    expect(selectEffectiveRate(rates, "2026-06-15")).toEqual(rates[0]);
    expect(selectEffectiveRate(rates, "2026-07-01")).toEqual(rates[1]);
    expect(selectEffectiveRate(rates, "2027-01-01")).toEqual(rates[1]);
  });

  it("returns null when no rate is effective", () => {
    expect(selectEffectiveRate(rates, "2025-12-31")).toBeNull();
  });

  it("picks the most recent rate when multiple overlap", () => {
    const overlapping: EffectiveDatedRate[] = [
      {
        rateCents: 7000,
        lessonDurationMinutes: 30,
        effectiveFrom: "2026-01-01",
        effectiveUntil: null,
      },
      {
        rateCents: 7500,
        lessonDurationMinutes: 30,
        effectiveFrom: "2026-07-01",
        effectiveUntil: null,
      },
    ];
    expect(selectEffectiveRate(overlapping, "2026-08-01")).toEqual(
      overlapping[1],
    );
    expect(selectEffectiveRate(overlapping, "2026-06-15")).toEqual(
      overlapping[0],
    );
  });

  it("throws for an invalid date string", () => {
    expect(() => selectEffectiveRate(rates, "not-a-date")).toThrow(
      "ISO date",
    );
  });
});

// ---------------------------------------------------------------------------
// Single-booking / deposit outcomes
// ---------------------------------------------------------------------------

describe("calculateDepositAmount", () => {
  it("returns one third of the rate, rounded up", () => {
    expect(calculateDepositAmount(9000)).toBe(3000);
    expect(calculateDepositAmount(10000)).toBe(3334);
  });

  it("rejects zero or negative rates", () => {
    expect(() => calculateDepositAmount(0)).toThrow("positive");
    expect(() => calculateDepositAmount(-1)).toThrow("positive");
  });
});

describe("resolveBookingOutcome", () => {
  it("returns deposit for single_booking", () => {
    expect(resolveBookingOutcome("single_booking", 9000)).toEqual({
      billingModel: "single_booking",
      depositCents: 3000,
    });
  });

  it("returns no deposit for monthly_prepaid", () => {
    expect(resolveBookingOutcome("monthly_prepaid", 9000)).toEqual({
      billingModel: "monthly_prepaid",
    });
  });
});

// ---------------------------------------------------------------------------
// Payment allocation
// ---------------------------------------------------------------------------

describe("allocatePayment", () => {
  function bill(
    overrides: Partial<BillForAllocation> & { id: string },
  ): BillForAllocation {
    return {
      totalCents: 10000,
      adjustmentsCents: 0,
      creditsAppliedCents: 0,
      paidCents: 0,
      dueDate: null,
      status: "issued",
      ...overrides,
    };
  }

  it("allocates to a single bill", () => {
    const result = allocatePayment({
      paymentAmountCents: 5000,
      bills: [bill({ id: "b1", totalCents: 10000 })],
    });
    expect(result).toEqual([{ billId: "b1", amountCents: 5000 }]);
  });

  it("allocates oldest due date first", () => {
    const result = allocatePayment({
      paymentAmountCents: 8000,
      bills: [
        bill({ id: "b1", totalCents: 6000, dueDate: "2026-07-01" }),
        bill({ id: "b2", totalCents: 6000, dueDate: "2026-08-01" }),
      ],
    });
    expect(result).toEqual([
      { billId: "b1", amountCents: 6000 },
      { billId: "b2", amountCents: 2000 },
    ]);
  });

  it("sorts null due dates after known due dates", () => {
    const result = allocatePayment({
      paymentAmountCents: 15000,
      bills: [
        bill({ id: "b1", totalCents: 5000, dueDate: null }),
        bill({ id: "b2", totalCents: 5000, dueDate: "2026-06-01" }),
        bill({ id: "b3", totalCents: 5000, dueDate: "2026-07-01" }),
      ],
    });
    // b2 (June) first, then b3 (July), then b1 (no due date)
    expect(result).toEqual([
      { billId: "b2", amountCents: 5000 },
      { billId: "b3", amountCents: 5000 },
      { billId: "b1", amountCents: 5000 },
    ]);
  });

  it("handles partial payment across multiple bills", () => {
    const result = allocatePayment({
      paymentAmountCents: 3500,
      bills: [
        bill({ id: "b1", totalCents: 2000, dueDate: "2026-07-01" }),
        bill({ id: "b2", totalCents: 3000, dueDate: "2026-08-01" }),
      ],
    });
    expect(result).toEqual([
      { billId: "b1", amountCents: 2000 },
      { billId: "b2", amountCents: 1500 },
    ]);
  });

  it("respects outstanding from adjustments, credits, and prior payments", () => {
    const result = allocatePayment({
      paymentAmountCents: 5000,
      bills: [
        bill({
          id: "b1",
          totalCents: 10000,
          adjustmentsCents: -2000,
          creditsAppliedCents: 3000,
          paidCents: 1000,
          dueDate: "2026-07-01",
        }),
      ],
    });
    // outstanding = 10000 - 2000 - 3000 - 1000 = 4000
    expect(result).toEqual([{ billId: "b1", amountCents: 4000 }]);
  });

  it("skips fully paid bills", () => {
    const result = allocatePayment({
      paymentAmountCents: 5000,
      bills: [
        bill({ id: "b1", totalCents: 5000, paidCents: 5000, dueDate: "2026-06-01" }),
        bill({ id: "b2", totalCents: 5000, dueDate: "2026-07-01" }),
      ],
    });
    expect(result).toEqual([{ billId: "b2", amountCents: 5000 }]);
  });

  it("skips draft/cancelled/void bills", () => {
    const result = allocatePayment({
      paymentAmountCents: 5000,
      bills: [
        bill({ id: "b1", totalCents: 5000, status: "draft", dueDate: "2026-06-01" }),
        bill({ id: "b2", totalCents: 5000, status: "issued", dueDate: "2026-07-01" }),
      ],
    });
    expect(result).toEqual([{ billId: "b2", amountCents: 5000 }]);
  });

  describe("explicit allocations", () => {
    it("uses explicit allocations first, then oldest-first for remainder", () => {
      const result = allocatePayment({
        paymentAmountCents: 10000,
        explicitAllocations: [{ billId: "b2", amountCents: 3000 }],
        bills: [
          bill({ id: "b1", totalCents: 5000, dueDate: "2026-07-01" }),
          bill({ id: "b2", totalCents: 5000, dueDate: "2026-08-01" }),
        ],
      });
      expect(result).toEqual([
        { billId: "b2", amountCents: 5000 },
        { billId: "b1", amountCents: 5000 },
      ]);
    });

    it("rejects explicit allocations exceeding payment amount", () => {
      expect(() =>
        allocatePayment({
          paymentAmountCents: 1000,
          explicitAllocations: [{ billId: "b1", amountCents: 2000 }],
          bills: [bill({ id: "b1", totalCents: 5000 })],
        }),
      ).toThrow("Explicit allocations exceed payment amount");
    });

    it("rejects explicit allocation exceeding bill outstanding", () => {
      expect(() =>
        allocatePayment({
          paymentAmountCents: 5000,
          explicitAllocations: [{ billId: "b1", amountCents: 3000 }],
          bills: [bill({ id: "b1", totalCents: 2000 })],
        }),
      ).toThrow("exceeds outstanding balance");
    });
  });

  it("returns empty array for no open bills", () => {
    const result = allocatePayment({
      paymentAmountCents: 5000,
      bills: [bill({ id: "b1", status: "draft" })],
    });
    expect(result).toEqual([]);
  });

  it("rejects non-integer payment amount", () => {
    expect(() =>
      allocatePayment({
        paymentAmountCents: 10.5,
        bills: [],
      }),
    ).toThrow("integer number of cents");
  });
});
