import type { PriceDeclaration, PromotionCodeDeclaration } from "../shared/pricing.js";

/** A price Stripe holds, as the sync reads it. `interval` is null for a one-time price. */
export interface StripePriceState {
  readonly id: string;
  readonly lookupKey: string | null;
  readonly active: boolean;
  readonly amountCents: number | null;
  readonly currency: string;
  readonly interval: string | null;
  readonly taxBehavior: string;
}

export type PriceAction =
  | { readonly _tag: "keep"; readonly declaration: PriceDeclaration; readonly priceId: string }
  | { readonly _tag: "create"; readonly declaration: PriceDeclaration }
  | {
      readonly _tag: "replace";
      readonly declaration: PriceDeclaration;
      /** The active price holding the lookup key now; the new price takes the key and this one is archived. */
      readonly archivedPriceId: string;
    };

export type PromotionAction =
  | { readonly _tag: "keep"; readonly code: string }
  | { readonly _tag: "create"; readonly declaration: PromotionCodeDeclaration };

const matchesDeclaration = (state: StripePriceState, declaration: PriceDeclaration) =>
  state.amountCents === declaration.amountCents &&
  state.currency === declaration.currency &&
  state.interval === declaration.interval &&
  state.taxBehavior === declaration.taxBehavior;

/**
 * What the sync does for each declared price, given the prices Stripe holds. Only active prices count:
 * an archived price is history, so a declaration whose only price is archived is created afresh.
 */
export function planPriceActions(
  declarations: ReadonlyArray<PriceDeclaration>,
  prices: ReadonlyArray<StripePriceState>,
): ReadonlyArray<PriceAction> {
  return declarations.map((declaration): PriceAction => {
    const current = prices.find(
      (price) => price.active && price.lookupKey === declaration.lookupKey,
    );
    if (current === undefined) return { _tag: "create", declaration };
    if (matchesDeclaration(current, declaration)) {
      return { _tag: "keep", declaration, priceId: current.id };
    }
    return { _tag: "replace", declaration, archivedPriceId: current.id };
  });
}

/** Promotion codes are case-insensitive in Stripe, so the comparison ignores case. */
export function planPromotionActions(
  declarations: ReadonlyArray<PromotionCodeDeclaration>,
  activeCodes: ReadonlyArray<string>,
): ReadonlyArray<PromotionAction> {
  const held = new Set(activeCodes.map((code) => code.toUpperCase()));
  return declarations.map((declaration): PromotionAction =>
    held.has(declaration.code.toUpperCase())
      ? { _tag: "keep", code: declaration.code }
      : { _tag: "create", declaration },
  );
}
