import { HttpError } from "../pgErrors.js";

/**
 * A missing Stripe setting answers 503 for the endpoints that need it. The server still boots
 * without it. Shared by the Checkout service and the webhook, each of which reads its own settings.
 */
export const notConfigured = () =>
  new HttpError({ status: 503, message: "Subscriptions are not configured" });
