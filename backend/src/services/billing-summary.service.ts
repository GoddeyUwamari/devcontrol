/**
 * The billing summary the Billing page renders (GET /api/stripe/subscription).
 * Every value is decided here, on the server, so the page maps nothing from
 * a Stripe status to a plan. The parts stay separate:
 *  - plan: the stored plan, the effective plan (entitlementOf), the billing
 *    hold, where the plan comes from (a subscription, our team, or none);
 *  - subscription: the recorded Stripe subscription's state, or null;
 *  - trial: whether the organization used its trial, whether one is running
 *    and when it ends, and whether it is eligible now;
 *  - usage: AWS resources counted and the limit, exactly as checkResourceLimit
 *    enforces them, or null when they cannot be read;
 *  - actions: what the page may offer.
 *
 * Dates, price and interval come from Stripe data this server already
 * received (subscription-snapshot.service); the summary calls Stripe only on
 * a cache miss, once. No Stripe id is ever part of the summary.
 */
import { pool } from '../config/database';
import stripeService, { isSalesLedTier, isTerminalSubscriptionStatus } from './stripe.service';
import {
  entitlementOf,
  getResourceUsage,
  isOrgRestricted,
  planSourceOf,
  upgradeAvailableOf,
  TOP_TIER,
  type EntitlementHold,
  type PlanSource,
  type SubscriptionTier,
} from '../middleware/subscription.middleware';
import { TRIAL_ELIGIBLE_SQL } from './checkout-reservation.service';
import { isTrialEnabled } from '../config/trial';
import { cachedSubscription, rememberSubscription, type SubscriptionSnapshot } from './subscription-snapshot.service';

export interface BillingSummary {
  plan: {
    storedTier: SubscriptionTier;
    effectiveTier: SubscriptionTier;
    entitlementHold: EntitlementHold | null;
    source: PlanSource;
    isTopPlan: boolean;
  };
  subscription: null | {
    status: string | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
    cancelAt: number | null;
    price: SubscriptionSnapshot['price'];
  };
  trial: {
    used: boolean;
    active: boolean;
    endsAt: number | null;
    eligible: boolean;
  };
  usage: {
    awsResources: { used: number; limit: number | null } | null;
  };
  actions: {
    /** Checkout (a new subscription), change-plan (the recorded one), or neither (our team, or Revenue Protection). */
    selfServe: 'checkout' | 'change_plan' | 'none';
    /** Whether "Upgrade Plan" and the upgrade prompts are shown. */
    showUpgrade: boolean;
    /** Whether the recorded subscription can be canceled, resumed or managed in the Customer Portal. */
    manageSubscription: boolean;
  };
  /** The payment-failure lifecycle, as before (display only). */
  lifecycle: {
    billingLifecycleState: string | null;
    paymentFailedAt: number | null;
    graceEndsAt: number | null;
    isRestricted: boolean;
  };
}

const toEpochSeconds = (value: unknown): number | null =>
  value ? Math.floor(new Date(value as string).getTime() / 1000) : null;

/** The snapshot of a recorded subscription: the cache, or one Stripe read on a miss (null if Stripe is unreadable). */
async function snapshotFor(subscriptionId: string): Promise<SubscriptionSnapshot | null> {
  const cached = cachedSubscription(subscriptionId);
  if (cached) return cached;
  try {
    const subscription = await stripeService.getSubscription(subscriptionId);
    rememberSubscription(subscription);
    return cachedSubscription(subscriptionId);
  } catch {
    // Name and code are logged by StripeService; the page shows no dates or price.
    return null;
  }
}

async function awsResourceUsageOf(organizationId: string): Promise<BillingSummary['usage']['awsResources']> {
  try {
    const { limits, usage } = await getResourceUsage(organizationId);
    return { used: usage.awsResources, limit: limits.maxResources === -1 ? null : limits.maxResources };
  } catch (error) {
    console.error(`[Billing] Could not read AWS resource usage for organization ${organizationId}:`, error instanceof Error ? error.name : 'error');
    return null;
  }
}

/** The organization's billing summary, or null if it does not exist. */
export async function billingSummaryOf(organizationId: string): Promise<BillingSummary | null> {
  const { rows } = await pool.query(
    `SELECT id, subscription_tier, subscription_status, stripe_subscription_id,
            billing_lifecycle_state, grace_period_ends_at, payment_failed_at,
            subscription_cancel_at_period_end, trial_used_at,
            ${TRIAL_ELIGIBLE_SQL} AS trial_eligible
       FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
    [organizationId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];

  const { storedTier, effectiveTier, hold } = entitlementOf(row);
  const source = planSourceOf(row);
  const recordedSubscriptionId: string | null = row.stripe_subscription_id ?? null;
  const billable = recordedSubscriptionId !== null && !isTerminalSubscriptionStatus(row.subscription_status);
  const snapshot = billable && recordedSubscriptionId ? await snapshotFor(recordedSubscriptionId) : null;
  const trialActive = billable && row.subscription_status === 'trialing';

  const selfServe: BillingSummary['actions']['selfServe'] =
    isSalesLedTier(storedTier) || source === 'managed' ? 'none' : billable ? 'change_plan' : 'checkout';

  return {
    plan: { storedTier, effectiveTier, entitlementHold: hold, source, isTopPlan: storedTier === TOP_TIER },
    subscription: recordedSubscriptionId === null
      ? null
      : {
          status: row.subscription_status ?? null,
          currentPeriodEnd: snapshot?.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: snapshot ? snapshot.cancelAtPeriodEnd : row.subscription_cancel_at_period_end === true,
          cancelAt: snapshot?.cancelAt ?? null,
          price: snapshot?.price ?? null,
        },
    trial: {
      used: row.trial_used_at !== null && row.trial_used_at !== undefined,
      active: trialActive,
      endsAt: trialActive ? snapshot?.trialEnd ?? null : null,
      eligible: isTrialEnabled() && selfServe === 'checkout' && row.trial_eligible === true,
    },
    usage: { awsResources: await awsResourceUsageOf(organizationId) },
    actions: {
      selfServe,
      showUpgrade: upgradeAvailableOf(row),
      manageSubscription: billable,
    },
    lifecycle: {
      billingLifecycleState: row.billing_lifecycle_state ?? null,
      paymentFailedAt: toEpochSeconds(row.payment_failed_at),
      graceEndsAt: toEpochSeconds(row.grace_period_ends_at),
      isRestricted: isOrgRestricted(row),
    },
  };
}
