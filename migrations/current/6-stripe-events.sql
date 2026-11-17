/*
 * The Stripe events the webhook has received. The primary key makes a redelivered event a no-op:
 * the webhook inserts the event id in the same transaction as the event's effect, so an event
 * whose effect fails leaves no id behind and Stripe's retry applies it.
 *
 * Every statement here reruns safely: `graphile-migrate watch` applies this file after each edit,
 * and the release commit applies it again on a database that already has it.
 */

create table if not exists app_private.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

comment on table app_private.stripe_events is
  E'Stripe event ids the webhook has applied. Written by the webhook as the root role; no visitor reads it.';
