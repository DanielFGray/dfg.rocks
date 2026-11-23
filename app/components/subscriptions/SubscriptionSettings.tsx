import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { api } from "../../lib/api.js";
import { mySubscriptionQuery, planName } from "../../lib/subscriptions.js";
import type {
  MySubscriptionResponse,
  SubscriptionView,
} from "../../../shared/api/subscriptions.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

/** The reader's subscription on the settings page: its status, who pays, and the Customer Portal. */
export function SubscriptionSettings() {
  const { data, isPending, isError } = useQuery(mySubscriptionQuery);
  const portal = useMutation({
    mutationFn: () => Effect.runPromise(api.subscriptions.openPortal()),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
  });

  return (
    <Card data-testid="subscription-settings" className="mb-8">
      <h2 className="mb-4 text-xl font-semibold tracking-tight">Subscription</h2>
      {isPending ? (
        <p className="text-muted">Loading...</p>
      ) : isError ? (
        <p className="text-muted">Your subscription could not be loaded.</p>
      ) : (
        <SubscriptionBody
          status={data}
          onManage={() => portal.mutate()}
          managing={portal.isPending}
        />
      )}
      {portal.isError ? (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {portal.error.message}
        </p>
      ) : null}
    </Card>
  );
}

function SubscriptionBody({
  status,
  onManage,
  managing,
}: {
  status: MySubscriptionResponse;
  onManage: () => void;
  managing: boolean;
}) {
  const { own, covering } = status;
  // The reader's own live subscription is shown and managed here, even when a family also covers
  // the reader. A covering family subscription is managed by its billing contact.
  if (own !== null && (own.live || covering === null)) {
    return (
      <div className="flex flex-col gap-4">
        <p data-testid="subscription-status" className="text-primary">
          {statusLine(own)}
        </p>
        <div>
          <Button
            data-testid="manage-subscription"
            variant="outline"
            onClick={onManage}
            disabled={managing}
          >
            Manage subscription
          </Button>
        </div>
      </div>
    );
  }
  if (covering !== null) {
    return (
      <div className="flex flex-col gap-4">
        <p data-testid="subscription-status" className="text-primary">
          {statusLine(covering)}
        </p>
        <p data-testid="subscription-billing-contact" className="text-muted">
          Your family's billing contact manages the subscription.
        </p>
      </div>
    );
  }
  if (status.checkout === "no_billing_contact") {
    return (
      <p data-testid="subscription-billing-contact" className="text-muted">
        Your family has no billing contact yet.
      </p>
    );
  }
  if (status.checkout === "not_billing_contact") {
    return (
      <p data-testid="subscription-billing-contact" className="text-muted">
        Your family's billing contact can subscribe for the family.
      </p>
    );
  }
  return (
    <p data-testid="subscription-none" className="text-muted">
      You have no subscription.{" "}
      <Link to="/pricing" className="text-accent">
        See the plans
      </Link>
    </p>
  );
}

/** The sentence that states a subscription's plan, its end or renewal date, and its payment state. */
function statusLine(subscription: SubscriptionView): string {
  const plan = subscription.plan === null ? "Subscription" : planName[subscription.plan];
  const date = subscription.current_period_end.toLocaleDateString("en-US", { dateStyle: "long" });
  if (subscription.status === "past_due") {
    return `${plan} is past due. Stripe retries the card; update the payment method in Manage subscription.`;
  }
  if (subscription.status === "active" || subscription.status === "trialing") {
    return subscription.cancel_at_period_end
      ? `${plan} ends on ${date}.`
      : `${plan} renews on ${date}.`;
  }
  return `${plan} is ${subscription.status}.`;
}
