/**
 * Stripe subscription statuses, grouped by what they mean for billing and
 * access. One list per meaning, shared by the checkout reservation and the
 * webhook identity guard (stripe.service.ts, checkout-reservation.service.ts)
 * and the effective-tier decision (subscription.middleware.ts entitlementOf).
 * Kept in its own module so the middleware and the Stripe service can both
 * import it without importing each other.
 */

// Subscription statuses after which Stripe never bills the subscription
// again. Every other status ('trialing', 'active', 'past_due', 'unpaid',
// 'incomplete', 'paused') belongs to a subscription that bills, or can
// recover and bill, so it counts as the organization's billable
// subscription.
export const TERMINAL_SUBSCRIPTION_STATUSES: readonly string[] = ['canceled', 'incomplete_expired'];

export function isTerminalSubscriptionStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_SUBSCRIPTION_STATUSES.includes(status);
}

/**
 * Every status Stripe defines for a subscription (Stripe.Subscription.Status
 * in the installed SDK). A recorded subscription with any other value
 * (including the column default 'free', or NULL) is unrecognised.
 */
export const KNOWN_SUBSCRIPTION_STATUSES: readonly string[] = [
  'trialing',
  'active',
  'past_due',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'canceled',
  'paused',
];
