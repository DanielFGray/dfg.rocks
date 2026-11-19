import { randomUUID } from "node:crypto";

/** Runs one SQL statement with bound parameters; a pg Pool's `query` or a client's fits. */
export type SqlQuery = (text: string, params: unknown[]) => Promise<unknown>;

/**
 * Inserts an app_public.subscriptions row for a payer. Each row gets a fresh Stripe subscription
 * id, which the table requires to be unique. `periodEndInDays` is relative to now, so a negative
 * value makes a period that has ended.
 */
export async function insertSubscription(
  query: SqlQuery,
  row: {
    payerId: string;
    customerId: string;
    status?: string;
    periodEndInDays?: number;
  },
): Promise<void> {
  await query(
    `insert into app_public.subscriptions
       (payer_id, stripe_customer_id, stripe_subscription_id, status, price_id, current_period_end,
        stripe_event_created)
     values ($1, $2, $3, $4, 'price_test', now() + make_interval(days => $5), now())`,
    [
      row.payerId,
      row.customerId,
      `sub_${randomUUID()}`,
      row.status ?? "active",
      row.periodEndInDays ?? 30,
    ],
  );
}
