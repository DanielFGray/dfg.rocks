import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { mySubscriptionQuery } from "../../lib/subscriptions.js";
import { Main } from "../../components/ui/Container.js";
import { Button } from "../../components/ui/Button.js";

export const Route = createFileRoute("/_authed/subscribe/success")({
  head: () => ({ meta: [{ title: "Subscribed | DFG Portal" }] }),
  component: SubscribeSuccessPage,
});

// How long the page waits for the webhook. Past it, the page stops asking and points to settings.
const confirmationWaitMillis = 60_000;

/**
 * Stripe sends the reader here before its webhook has recorded the subscription. The page polls until
 * the reader has a live subscription of their own, or until the wait runs out.
 */
function SubscribeSuccessPage() {
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setWaiting(false), confirmationWaitMillis);
    return () => clearTimeout(timer);
  }, []);

  const { data } = useQuery({
    ...mySubscriptionQuery,
    refetchInterval: (query) => (query.state.data?.own?.live || !waiting ? false : 2_000),
  });
  const subscribed = data?.own?.live === true;

  return (
    <Main data-testid="subscribe-success">
      {subscribed ? (
        <>
          <h1 data-testid="subscribed" className="mb-4 text-3xl font-bold tracking-tight">
            You are subscribed
          </h1>
          <p className="mb-6 text-muted dark:text-muted-dark">
            Your lessons are open. Lessons and courses now show your subscription.
          </p>
          <Link to="/courses">
            <Button>Go to my courses</Button>
          </Link>
        </>
      ) : waiting ? (
        <>
          <h1 data-testid="subscription-pending" className="mb-4 text-3xl font-bold tracking-tight">
            Confirming your subscription
          </h1>
          <p className="text-muted dark:text-muted-dark">
            This page updates as soon as the payment has been recorded.
          </p>
        </>
      ) : (
        <>
          <h1
            data-testid="subscription-still-pending"
            className="mb-4 text-3xl font-bold tracking-tight"
          >
            Your subscription is still being confirmed
          </h1>
          <p className="mb-6 text-muted dark:text-muted-dark">
            Payment can take a few minutes to reach the portal. Your subscription status is on the
            settings page.
          </p>
          <Link to="/settings">
            <Button variant="outline">Go to settings</Button>
          </Link>
        </>
      )}
    </Main>
  );
}
