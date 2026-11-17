import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { mySubscriptionQuery } from "../../lib/subscriptions.js";
import type { MySubscriptionResponse } from "../../../shared/api/subscriptions.js";
import { Button } from "../ui/Button.js";

/**
 * A message where the reader's content is locked or missing, with the action that fixes it. Who
 * acts depends on who pays: a family member cannot subscribe for themselves, so they see who does.
 */
export function SubscribeCallout({ message }: { message: string }) {
  const { data } = useQuery(mySubscriptionQuery);
  return (
    <div
      data-testid="subscribe-callout"
      className="flex flex-col items-center justify-center gap-4 rounded-xl border border-overlay/6 bg-card px-6 py-12 text-center dark:border-overlay-dark/6 dark:bg-card-dark"
    >
      <p className="text-muted dark:text-muted-dark">{message}</p>
      {data === undefined ? null : <SubscribeAction status={data} />}
    </div>
  );
}

function SubscribeAction({ status }: { status: MySubscriptionResponse }) {
  const message = (text: string) => (
    <p data-testid="billing-contact-message" className="text-sm text-muted dark:text-muted-dark">
      {text}
    </p>
  );
  switch (status.checkout) {
    case "allowed":
      return (
        <Link to="/pricing">
          <Button data-testid="subscribe-cta">Subscribe</Button>
        </Link>
      );
    case "covered":
      return (
        <Link to="/settings">
          <Button variant="outline">Subscription settings</Button>
        </Link>
      );
    case "not_billing_contact":
      return message("Your family's billing contact can subscribe for the family.");
    case "no_billing_contact":
      return message("Your family has no billing contact yet, so no subscription covers you.");
  }
}
