/**
 * The online plans and the promotion codes Stripe must hold. `scripts/stripe-sync-prices.ts` makes
 * Stripe match this file; editing a price here and running the sync is how a price changes.
 * Stripe keeps the price a subscriber signed up at, so a change applies to new subscribers only.
 */

/** A Stripe price, found by its lookup key. `interval` is null for a one-time price. */
export interface PriceDeclaration {
  /** The plan name, stored on the price as metadata.plan: a subscriber keeps it after the price is archived. */
  readonly plan: string;
  readonly lookupKey: string;
  /** In the currency's smallest unit. */
  readonly amountCents: number;
  readonly currency: "usd";
  readonly interval: "month" | null;
  readonly taxBehavior: "exclusive";
}

export const productId = "dfg_rocks_content";

export const productName = "DFG Music Lessons";

/** Keyed by plan name. The server finds a price by lookup key; the price's metadata.plan names the plan. */
export const planPrices = {
  monthly: {
    plan: "monthly",
    lookupKey: "monthly",
    amountCents: 1000,
    currency: "usd",
    interval: "month",
    taxBehavior: "exclusive",
  },
  lifetime: {
    plan: "lifetime",
    lookupKey: "lifetime",
    amountCents: 10000,
    currency: "usd",
    interval: null,
    taxBehavior: "exclusive",
  },
} satisfies Record<string, PriceDeclaration>;

/** A standing promotion code. One-off codes are made in Stripe and are not declared here. */
export interface PromotionCodeDeclaration {
  readonly code: string;
  readonly off:
    | { readonly kind: "percent"; readonly percent: number }
    | { readonly kind: "amount"; readonly amountCents: number; readonly currency: "usd" };
  readonly duration:
    | { readonly kind: "once" }
    | { readonly kind: "repeating"; readonly months: number }
    | { readonly kind: "forever" };
  readonly maxRedemptions?: number;
}

export const promotionCodes: ReadonlyArray<PromotionCodeDeclaration> = [];
