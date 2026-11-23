import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Effect, Schema as S } from "effect";
import { api } from "../lib/api.js";
import { authUserQuery } from "../lib/queries.js";
import {
  formatPlanAmount,
  mySubscriptionQuery,
  planName,
  subscriptionPlansQuery,
} from "../lib/subscriptions.js";
import type {
  CheckoutEligibility,
  PlanPrice,
  SubscriptionPlan,
} from "../../shared/api/subscriptions.js";

type CheckoutBlock = Exclude<CheckoutEligibility, "allowed">;
import { ServiceUnavailableError } from "../../shared/httpApiErrors.js";
import { Main } from "../components/ui/Container.js";
import { Card } from "../components/ui/Card.js";
import { Button } from "../components/ui/Button.js";

export const Route = createFileRoute("/pricing")({
  head: () => ({ meta: [{ title: "Pricing | DFG Portal" }] }),
  component: PricingPage,
});

function PricingPage() {
  const plans = useQuery(subscriptionPlansQuery);
  const auth = useQuery(authUserQuery);
  // Undefined until the session check answers; a click before then must not read as signed-out.
  const signedIn = auth.isSuccess ? auth.data.user !== null : undefined;
  const billing = useQuery({ ...mySubscriptionQuery, enabled: signedIn === true });
  // A signed-in reader who may not start a subscription sees why instead of a Subscribe button.
  const checkoutState = billing.data?.checkout;
  const blocked = checkoutState === undefined || checkoutState === "allowed" ? null : checkoutState;

  return (
    <Main data-testid="pricing">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">Online courses</h1>
      <p className="mb-8 text-muted">
        A subscription covers the whole family: every student in it can read the courses.
      </p>

      {plans.isPending ? (
        <p className="text-muted">Loading...</p>
      ) : plans.isError ? (
        <p data-testid="subscriptions-unavailable" className="text-muted">
          {S.is(ServiceUnavailableError)(plans.error)
            ? "Subscriptions are not available yet."
            : "The prices could not be loaded. Try again in a moment."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.data.map((price) => (
            <PlanCard key={price.plan} price={price} signedIn={signedIn} blocked={blocked} />
          ))}
        </div>
      )}
    </Main>
  );
}

const blockedReason: Record<CheckoutBlock, string> = {
  covered: "A subscription already covers you. Its status is on your settings page.",
  not_billing_contact: "Your family's billing contact subscribes for you.",
  no_billing_contact: "Your family has no billing contact yet, so it cannot subscribe.",
};

function PlanCard({
  price,
  signedIn,
  blocked,
}: {
  price: PlanPrice;
  signedIn: boolean | undefined;
  blocked: CheckoutBlock | null;
}) {
  const checkout = useMutation({
    mutationFn: (plan: SubscriptionPlan) =>
      Effect.runPromise(api.subscriptions.startCheckout({ payload: { plan } })),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  return (
    <Card data-testid={`plan-${price.plan}`}>
      <h2 className="text-xl font-semibold tracking-tight">{planName[price.plan]}</h2>
      <p className="mt-2 text-3xl font-bold tracking-tight">
        <span data-testid={`price-${price.plan}`}>{formatPlanAmount(price)}</span>{" "}
        <span className="text-base font-normal text-muted">
          per {price.interval}
        </span>
      </p>
      <div className="mt-6">
        {blocked !== null ? (
          <p data-testid="checkout-blocked" className="text-sm text-muted">
            {blockedReason[blocked]}
          </p>
        ) : signedIn === undefined ? (
          <Button data-testid={`subscribe-${price.plan}`} disabled>
            Subscribe
          </Button>
        ) : signedIn ? (
          <Button
            data-testid={`subscribe-${price.plan}`}
            onClick={() => checkout.mutate(price.plan)}
            disabled={checkout.isPending}
          >
            Subscribe
          </Button>
        ) : (
          <Link to="/login" search={{ redirect: "/pricing" }}>
            <Button data-testid={`subscribe-${price.plan}`}>Subscribe</Button>
          </Link>
        )}
      </div>
      {checkout.isError ? (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {checkout.error.message}
        </p>
      ) : null}
    </Card>
  );
}
