/**
 * What the billing page shows about a Stripe subscription that the database
 * does not hold (trial end, current period end, price and interval), taken
 * from subscription objects this server has already received: webhook
 * payloads, the completion handler's re-read, and the responses of its own
 * cancel / change-plan / resume calls. Kept in memory per process, keyed by
 * subscription id, so rendering the billing page does not call Stripe each
 * time. A miss (another instance received the event, a restart, or an entry
 * older than the lifetime below) is filled by one read of the subscription,
 * which is cached in turn.
 *
 * Display only: access is always decided from the organization row
 * (entitlementOf), never from this cache.
 */

/** A cached entry is used for at most this long. */
export const SUBSCRIPTION_SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;

export interface SubscriptionSnapshot {
  status: string | null;
  /** Unix seconds; null when the subscription has no trial. */
  trialStart: number | null;
  trialEnd: number | null;
  /** Unix seconds, from the subscription item (the field moved there in API 2025-03-31+). */
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  /** The item's price: amount in the currency's minor unit, lower-case ISO currency, and Stripe's interval. */
  price: { amount: number; currency: string; interval: 'month' | 'year' } | null;
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The display fields of a Stripe subscription object (payload or API response). */
export function snapshotOf(subscription: any): SubscriptionSnapshot {
  const item = subscription?.items?.data?.[0];
  const price = item?.price;
  const interval = price?.recurring?.interval;
  const amount = numberOrNull(price?.unit_amount);
  return {
    status: typeof subscription?.status === 'string' ? subscription.status : null,
    trialStart: numberOrNull(subscription?.trial_start),
    trialEnd: numberOrNull(subscription?.trial_end),
    currentPeriodStart: numberOrNull(item?.current_period_start),
    currentPeriodEnd: numberOrNull(item?.current_period_end),
    cancelAtPeriodEnd: subscription?.cancel_at_period_end === true,
    cancelAt: numberOrNull(subscription?.cancel_at),
    price:
      amount !== null && typeof price?.currency === 'string' && (interval === 'month' || interval === 'year')
        ? { amount, currency: price.currency, interval }
        : null,
  };
}

/** Whether Stripe shows a trial on this subscription (it had or has one). */
export function hasTrial(subscription: any): boolean {
  return numberOrNull(subscription?.trial_start) !== null;
}

const cache = new Map<string, { snapshot: SubscriptionSnapshot; storedAt: number }>();

/** Remember the display fields of a subscription object this server received. */
export function rememberSubscription(subscription: any): void {
  const id = subscription?.id;
  if (typeof id !== 'string' || id.length === 0) return;
  if (cache.size >= MAX_ENTRIES && !cache.has(id)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.delete(id);
  cache.set(id, { snapshot: snapshotOf(subscription), storedAt: Date.now() });
}

export function forgetSubscription(subscriptionId: string): void {
  cache.delete(subscriptionId);
}

/** The cached snapshot, or null when there is none or it is older than the lifetime. */
export function cachedSubscription(subscriptionId: string): SubscriptionSnapshot | null {
  const entry = cache.get(subscriptionId);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > SUBSCRIPTION_SNAPSHOT_TTL_MS) {
    cache.delete(subscriptionId);
    return null;
  }
  return entry.snapshot;
}

/** Tests only. */
export function clearSubscriptionSnapshots(): void {
  cache.clear();
}
