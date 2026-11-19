import { describe, expect, it } from "vitest";
import { planPromotionActions, planPriceActions, type StripePriceState } from "../../scripts/stripeSyncPlan.js";
import { planPrices, type PriceDeclaration } from "../../shared/pricing.js";

const monthly: PriceDeclaration = planPrices.monthly;

const activeMonthly: StripePriceState = {
  id: "price_current",
  lookupKey: "monthly",
  active: true,
  amountCents: 1000,
  currency: "usd",
  interval: "month",
  taxBehavior: "exclusive",
};

describe("planPriceActions", () => {
  it("creates a declared price that Stripe has no active price for", () => {
    expect(planPriceActions([monthly], [])).toEqual([{ _tag: "create", declaration: monthly }]);
  });

  it("creates a declared price whose only price under its lookup key is archived", () => {
    const archived = { ...activeMonthly, active: false };
    expect(planPriceActions([monthly], [archived])).toEqual([
      { _tag: "create", declaration: monthly },
    ]);
  });

  it("keeps an active price that matches the declaration on every field", () => {
    expect(planPriceActions([monthly], [activeMonthly])).toEqual([
      { _tag: "keep", declaration: monthly, priceId: "price_current" },
    ]);
  });

  it("replaces the active price when the amount differs, and archives it", () => {
    expect(planPriceActions([monthly], [{ ...activeMonthly, amountCents: 1500 }])).toEqual([
      { _tag: "replace", declaration: monthly, archivedPriceId: "price_current" },
    ]);
  });

  it("replaces the active price when the currency, interval or tax behavior differs", () => {
    const differing: ReadonlyArray<Partial<StripePriceState>> = [
      { currency: "eur" },
      { interval: "year" },
      { taxBehavior: "inclusive" },
      { taxBehavior: "unspecified" },
    ];
    for (const change of differing) {
      expect(planPriceActions([monthly], [{ ...activeMonthly, ...change }])).toEqual([
        { _tag: "replace", declaration: monthly, archivedPriceId: "price_current" },
      ]);
    }
  });

  it("replaces a recurring price with a one-time declaration", () => {
    const lifetime = planPrices.lifetime;
    const recurringAtLifetimeKey = { ...activeMonthly, lookupKey: "lifetime", amountCents: 10000 };
    expect(planPriceActions([lifetime], [recurringAtLifetimeKey])).toEqual([
      { _tag: "replace", declaration: lifetime, archivedPriceId: "price_current" },
    ]);
  });

  it("ignores prices under other lookup keys", () => {
    const other = { ...activeMonthly, lookupKey: "other" };
    expect(planPriceActions([monthly], [other])).toEqual([
      { _tag: "create", declaration: monthly },
    ]);
  });
});

const code = {
  code: "EARLY10",
  off: { kind: "percent", percent: 10 },
  duration: { kind: "once" },
} as const;

describe("planPromotionActions", () => {
  it("creates a declared promotion code Stripe does not hold", () => {
    expect(planPromotionActions([code], [])).toEqual([{ _tag: "create", declaration: code }]);
  });

  it("keeps a declared promotion code Stripe already holds", () => {
    expect(planPromotionActions([code], ["EARLY10"])).toEqual([{ _tag: "keep", code: "EARLY10" }]);
  });

  it("matches a held code regardless of case, since Stripe compares codes without case", () => {
    expect(planPromotionActions([code], ["early10"])).toEqual([{ _tag: "keep", code: "EARLY10" }]);
  });
});
