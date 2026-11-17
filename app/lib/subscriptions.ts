import { Effect } from "effect";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./api.js";
import type { PlanPrice, SubscriptionPlan } from "../../shared/api/subscriptions.js";

/** The reader's subscription and who pays for it. Refetched by the pages that depend on it. */
export const mySubscriptionQuery = queryOptions({
  queryKey: ["subscription", "me"],
  queryFn: () => Effect.runPromise(api.subscriptions.mySubscription()),
});

/** The two plans and their prices as Stripe states them. Public: the pricing page needs no sign-in. */
export const subscriptionPlansQuery = queryOptions({
  queryKey: ["subscription", "plans"],
  queryFn: () => Effect.runPromise(api.public.subscriptionPlans()).then((body) => body.plans),
});

export const planName: Record<SubscriptionPlan, string> = {
  monthly: "Monthly",
  annual: "Annual",
};

/** A plan's price for display. Stripe states amounts in minor units; the app's currency has two decimal places. */
export function formatPlanAmount(price: PlanPrice): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency.toUpperCase(),
  }).format(price.amount / 100);
}
