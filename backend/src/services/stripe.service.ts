import Stripe from 'stripe';
import { pool } from '../config/database';
import { TIER_LIMITS, SubscriptionTier } from '../middleware/subscription.middleware';

// Lazily constructed so importing this module never requires
// STRIPE_SECRET_KEY to be set -- construction only happens on the first
// real call into the Stripe SDK. Production behavior is unchanged: that
// first call still throws immediately if the key is missing/invalid, exactly
// as the previous eager module-load-time construction did; this only defers
// *when* that happens, it does not weaken or default the credential.
let stripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-12-15.clover',
    });
  }
  return stripeClient;
}

// Tiers a client is allowed to request Checkout for. 'free' is excluded --
// it has no Stripe price and never goes through Checkout.
export type CheckoutTier = 'starter' | 'pro' | 'enterprise';
export const CHECKOUT_TIERS: readonly CheckoutTier[] = ['starter', 'pro', 'enterprise'];

export function isCheckoutTier(value: unknown): value is CheckoutTier {
  return typeof value === 'string' && (CHECKOUT_TIERS as readonly string[]).includes(value);
}

// Billing cadence a client may choose. Purely a Checkout-time selector of
// which Stripe Price to buy -- it is never persisted and never changes
// entitlements; TIER_LIMITS is keyed by tier only, so starter-monthly and
// starter-annual always get identical resource limits.
export type BillingInterval = 'monthly' | 'annual';
export const BILLING_INTERVALS: readonly BillingInterval[] = ['monthly', 'annual'];

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === 'string' && (BILLING_INTERVALS as readonly string[]).includes(value);
}

// Tiers that support self-service annual billing. Enterprise is
// Contact-Sales only for annual pricing (no self-serve Checkout path exists
// for it anywhere in this app's UI) -- no Stripe Price should ever be
// created for enterprise/annual, and requests for that combination must be
// rejected before Checkout resolution is even attempted.
const ANNUAL_CAPABLE_TIERS: ReadonlySet<CheckoutTier> = new Set(['starter', 'pro']);

/**
 * Whether a (tier, interval) combination is actually offered via
 * self-service Checkout. This is the single source of truth for which
 * plans exist at all -- distinct from isCheckoutTier/isBillingInterval,
 * which only validate that each field is individually a recognized value.
 * Currently the only unsupported combination is enterprise/annual.
 */
export function isSupportedPlan(tier: CheckoutTier, interval: BillingInterval): boolean {
  return interval === 'monthly' || ANNUAL_CAPABLE_TIERS.has(tier);
}

/**
 * Canonical env var name(s) for each (tier, interval)'s Stripe Price ID, in
 * lookup priority order. This is the single source of truth for price
 * resolution -- both Checkout (getPriceIdForPlan) and webhook tier
 * detection (getTierFromPriceId) read through it, so the mapping can never
 * drift between the two directions.
 *
 * Monthly additionally accepts the legacy un-suffixed var name
 * (STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO, STRIPE_PRICE_ENTERPRISE) that
 * predates annual billing, so deployments configured before this feature
 * keep working without an env change. Annual has no legacy alias -- it is
 * new, and checkout for a tier/annual combination fails closed until its
 * *_ANNUAL var is set. Migration path: once every environment sets the
 * *_MONTHLY name explicitly, delete the legacy alias entry below.
 *
 * Canonical annual charges (read this before creating any *_ANNUAL Price in
 * Stripe -- Prices are immutable once created):
 *   - Starter: $490.00/year exactly (= $49 monthly x 10)
 *   - Pro:     $1,990.00/year exactly (= $199 monthly x 10)
 *   - Enterprise: no self-service annual Price -- Enterprise has no
 *     self-serve Checkout at all (contact-sales only in every UI surface
 *     across this repo's history), so *_ANNUAL should not be created for it
 *     without a separate product decision.
 * These totals are "2 months free," not a 20%-off discount ($490/12 =
 * $40.83 and $1,990/12 = $165.83, displayed rounded as ~$41 and ~$166
 * per-month-equivalent in the pricing UI). Source of truth: the annualPrice
 * (41, 166) and annualSavings (98, 398) constants already live in
 * app/(app)/settings/billing/upgrade/page.tsx and
 * app/(marketing)/pricing/page.tsx -- 12*49-490=98 and 12*199-1990=398
 * reproduce those exact hardcoded annualSavings values, which an even
 * 20%-off discount does not. Those two figures were deliberately corrected
 * in commits 10211f3 and 287109f (2026-05-08) from an earlier, buggy pair
 * (63/239, where "annual" was priced *above* monthly) and have not changed
 * since. components/billing/pricing-faq.tsx separately claims annual
 * billing "saves 20%" -- that copy predates and was never reconciled with
 * the 10211f3/287109f correction and should eventually be corrected to
 * describe the actual ~16.6% ("2 months free") discount rather than 20%.
 *
 * Enterprise deliberately has no `annual` entry: it is Contact-Sales only
 * for annual billing (see isSupportedPlan/ANNUAL_CAPABLE_TIERS above), so
 * there is no STRIPE_PRICE_ENTERPRISE_ANNUAL to resolve and none should be
 * created in Stripe or required by env validation.
 */
const PRICE_ENV_VAR_CANDIDATES: Record<CheckoutTier, Partial<Record<BillingInterval, readonly string[]>>> = {
  starter: {
    monthly: ['STRIPE_PRICE_STARTER_MONTHLY', 'STRIPE_PRICE_STARTER'],
    annual: ['STRIPE_PRICE_STARTER_ANNUAL'],
  },
  pro: {
    monthly: ['STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_PRICE_PRO'],
    annual: ['STRIPE_PRICE_PRO_ANNUAL'],
  },
  enterprise: {
    monthly: ['STRIPE_PRICE_ENTERPRISE_MONTHLY', 'STRIPE_PRICE_ENTERPRISE'],
  },
};

function resolvePriceEnvVar(
  tier: CheckoutTier,
  interval: BillingInterval
): { value: string | null; candidates: readonly string[] } {
  const candidates = PRICE_ENV_VAR_CANDIDATES[tier][interval];
  if (!candidates) {
    return { value: null, candidates: [] };
  }
  for (const name of candidates) {
    const value = process.env[name];
    if (value) return { value, candidates };
  }
  return { value: null, candidates };
}

/**
 * Every (tier, interval, priceId) triple whose env var is currently set.
 * Recomputed on each call (not cached) so env changes -- including in
 * tests -- are always reflected immediately.
 */
function getConfiguredPricePlans(): Array<{ tier: CheckoutTier; interval: BillingInterval; priceId: string }> {
  const plans: Array<{ tier: CheckoutTier; interval: BillingInterval; priceId: string }> = [];
  for (const tier of CHECKOUT_TIERS) {
    for (const interval of BILLING_INTERVALS) {
      const { value } = resolvePriceEnvVar(tier, interval);
      if (value) plans.push({ tier, interval, priceId: value });
    }
  }
  return plans;
}

export class StripeService {
  /**
   * Create a Stripe customer for an organization
   */
  async createCustomer(
    email: string,
    name: string,
    organizationId: string
  ): Promise<Stripe.Customer> {
    try {
      const customer = await getStripeClient().customers.create({
        email,
        name,
        metadata: {
          organizationId,
        },
      });

      // Update organization with Stripe customer ID
      await pool.query(
        `UPDATE organizations
         SET stripe_customer_id = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [customer.id, organizationId]
      );

      console.log(`Created Stripe customer ${customer.id} for organization ${organizationId}`);
      return customer;
    } catch (error) {
      console.error('Error creating Stripe customer:', error);
      throw error;
    }
  }

  /**
   * Create a Checkout Session for subscription
   */
  async createCheckoutSession(
    customerId: string,
    priceId: string,
    organizationId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<Stripe.Checkout.Session> {
    try {
      const session = await getStripeClient().checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          organizationId,
        },
        subscription_data: {
          metadata: {
            organizationId,
          },
        },
        allow_promotion_codes: true,
      });

      console.log(`Created checkout session ${session.id} for customer ${customerId}`);
      return session;
    } catch (error) {
      console.error('Error creating checkout session:', error);
      throw error;
    }
  }

  /**
   * Create a subscription directly (without checkout)
   */
  async createSubscription(
    customerId: string,
    priceId: string
  ): Promise<Stripe.Subscription> {
    try {
      const subscription = await getStripeClient().subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent'],
      });

      console.log(`Created subscription ${subscription.id} for customer ${customerId}`);
      return subscription;
    } catch (error) {
      console.error('Error creating subscription:', error);
      throw error;
    }
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    try {
      const subscription = await getStripeClient().subscriptions.cancel(subscriptionId);

      console.log(`Canceled subscription ${subscriptionId}`);
      return subscription;
    } catch (error) {
      console.error('Error canceling subscription:', error);
      throw error;
    }
  }

  /**
   * Cancel subscription at period end (don't cancel immediately)
   */
  async cancelSubscriptionAtPeriodEnd(
    subscriptionId: string
  ): Promise<Stripe.Subscription> {
    try {
      const subscription = await getStripeClient().subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });

      console.log(`Set subscription ${subscriptionId} to cancel at period end`);
      return subscription;
    } catch (error) {
      console.error('Error setting subscription to cancel at period end:', error);
      throw error;
    }
  }

  /**
   * Resume a subscription that was set to cancel
   */
  async resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    try {
      const subscription = await getStripeClient().subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });

      console.log(`Resumed subscription ${subscriptionId}`);
      return subscription;
    } catch (error) {
      console.error('Error resuming subscription:', error);
      throw error;
    }
  }

  /**
   * Update subscription to a new price/plan
   */
  async updateSubscription(
    subscriptionId: string,
    newPriceId: string
  ): Promise<Stripe.Subscription> {
    try {
      // Get current subscription
      const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);

      // Update the subscription item with new price
      const updatedSubscription = await getStripeClient().subscriptions.update(subscriptionId, {
        items: [
          {
            id: subscription.items.data[0].id,
            price: newPriceId,
          },
        ],
        proration_behavior: 'create_prorations',
      });

      console.log(`Updated subscription ${subscriptionId} to price ${newPriceId}`);
      return updatedSubscription;
    } catch (error) {
      console.error('Error updating subscription:', error);
      throw error;
    }
  }

  /**
   * Get upcoming invoice for a customer
   */
  async getUpcomingInvoice(customerId: string): Promise<any | null> {
    try {
      // Note: Upcoming invoice API may not be available in all Stripe SDK versions
      // Using any type to avoid type issues
      const invoice = await (getStripeClient().invoices as any).retrieveUpcoming({
        customer: customerId,
      });

      return invoice;
    } catch (error: any) {
      // Return null if no upcoming invoice (common for free tier)
      if (error.code === 'invoice_upcoming_none') {
        return null;
      }
      console.error('Error retrieving upcoming invoice:', error);
      throw error;
    }
  }

  /**
   * List invoices for a customer
   */
  async listInvoices(
    customerId: string,
    limit: number = 10
  ): Promise<Stripe.Invoice[]> {
    try {
      const invoices = await getStripeClient().invoices.list({
        customer: customerId,
        limit,
      });

      return invoices.data;
    } catch (error) {
      console.error('Error listing invoices:', error);
      throw error;
    }
  }

  /**
   * Create a customer portal session
   */
  async createPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<Stripe.BillingPortal.Session> {
    try {
      const session = await getStripeClient().billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      console.log(`Created portal session for customer ${customerId}`);
      return session;
    } catch (error) {
      console.error('Error creating portal session:', error);
      throw error;
    }
  }

  /**
   * Retrieve a subscription by ID
   */
  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    try {
      const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
      return subscription;
    } catch (error) {
      console.error('Error retrieving subscription:', error);
      throw error;
    }
  }

  /**
   * Retrieve a customer by ID
   */
  async getCustomer(customerId: string): Promise<Stripe.Customer> {
    try {
      const customer = await getStripeClient().customers.retrieve(customerId);
      return customer as Stripe.Customer;
    } catch (error) {
      console.error('Error retrieving customer:', error);
      throw error;
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string
  ): Stripe.Event | null {
    try {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.warn('STRIPE_WEBHOOK_SECRET not set - skipping signature verification');
        return null;
      }

      const event = getStripeClient().webhooks.constructEvent(payload, signature, webhookSecret);
      return event;
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      return null;
    }
  }

  /**
   * Update organization subscription info in database
   */
  async updateOrganizationSubscription(
    organizationId: string,
    data: {
      subscriptionId?: string;
      status?: string;
      tier?: string;
      currentPeriodStart?: Date;
      currentPeriodEnd?: Date;
      cancelAtPeriodEnd?: boolean;
    }
  ): Promise<void> {
    try {
      console.log(`📝 Updating organization ${organizationId} with data:`, JSON.stringify(data, null, 2));

      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (data.subscriptionId !== undefined) {
        updates.push(`stripe_subscription_id = $${paramIndex++}`);
        values.push(data.subscriptionId);
      }

      if (data.status !== undefined) {
        updates.push(`subscription_status = $${paramIndex++}`);
        values.push(data.status);
      }

      if (data.tier !== undefined) {
        // Only rewrite the tier + its entitlement columns when the tier is
        // actually changing. Stripe fires customer.subscription.updated for
        // many events (renewal, cancel_at_period_end toggling, etc.) that
        // resolve to the same tier -- those must still update whatever
        // other fields are present in `data`, but must not needlessly
        // rewrite subscription_tier/max_services/max_users/
        // max_deployments_per_month.
        const currentTierResult = await pool.query(
          'SELECT subscription_tier FROM organizations WHERE id = $1',
          [organizationId]
        );
        const currentTier = currentTierResult.rows[0]?.subscription_tier;

        if (currentTier !== data.tier) {
          // Entitlement limits are always derived from the canonical
          // TIER_LIMITS map for the tier -- never from caller-supplied
          // values -- and written in the same UPDATE as the tier itself so
          // they can never observably diverge.
          const tierLimits = TIER_LIMITS[data.tier as SubscriptionTier];

          updates.push(`subscription_tier = $${paramIndex++}`);
          values.push(data.tier);

          updates.push(`max_services = $${paramIndex++}`);
          values.push(tierLimits.maxServices);

          updates.push(`max_users = $${paramIndex++}`);
          values.push(tierLimits.maxUsers);

          updates.push(`max_deployments_per_month = $${paramIndex++}`);
          values.push(tierLimits.maxDeploymentsPerMonth);
        } else {
          console.log(`ℹ️ Tier unchanged (${currentTier}) - skipping entitlement rewrite`);
        }
      }

      if (data.currentPeriodStart !== undefined) {
        updates.push(`subscription_current_period_start = $${paramIndex++}`);
        values.push(data.currentPeriodStart);
      }

      if (data.currentPeriodEnd !== undefined) {
        updates.push(`subscription_current_period_end = $${paramIndex++}`);
        values.push(data.currentPeriodEnd);
      }

      if (data.cancelAtPeriodEnd !== undefined) {
        updates.push(`subscription_cancel_at_period_end = $${paramIndex++}`);
        values.push(data.cancelAtPeriodEnd);
      }

      if (updates.length === 0) {
        console.log('⚠️ No updates to perform');
        return;
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(organizationId);

      const query = `
        UPDATE organizations
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
      `;

      console.log(`🔍 SQL Query: ${query}`);
      console.log(`🔍 Values: ${JSON.stringify(values)}`);

      const result = await pool.query(query, values);
      console.log(`✅ Database update result: ${result.rowCount} row(s) affected`);
      console.log(`✅ Updated organization ${organizationId} subscription info`);
    } catch (error) {
      console.error('❌ Error updating organization subscription:', error);
      throw error;
    }
  }

  /**
   * Get organization by Stripe customer ID
   */
  async getOrganizationByCustomerId(customerId: string): Promise<any | null> {
    try {
      const result = await pool.query(
        'SELECT * FROM organizations WHERE stripe_customer_id = $1',
        [customerId]
      );

      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting organization by customer ID:', error);
      throw error;
    }
  }

  /**
   * Resolve the Stripe Price ID for a (tier, billingInterval) plan
   * exclusively from server-side env vars. No hardcoded fallback IDs -- an
   * unconfigured plan throws rather than silently checking out against a
   * stale/wrong price.
   */
  getPriceIdForPlan(tier: CheckoutTier, interval: BillingInterval): string {
    const { value, candidates } = resolvePriceEnvVar(tier, interval);
    if (!value) {
      throw new Error(
        `No Stripe Price ID configured for ${tier}/${interval} (checked: ${candidates.join(', ')})`
      );
    }
    return value;
  }

  /**
   * Canonical env var names (one per enabled tier/interval combination)
   * that resolve to no configured price. Used by env validation to fail
   * closed before startup rather than let checkout fail per-request.
   * Reports the canonical *_MONTHLY/*_ANNUAL name even for a monthly slot
   * satisfied only by the legacy unsuffixed alias -- callers should treat
   * the legacy alias as a stopgap, not a long-term substitute.
   *
   * Skips any (tier, interval) combination isSupportedPlan() rejects --
   * currently enterprise/annual -- so STRIPE_PRICE_ENTERPRISE_ANNUAL is
   * never required by startup env validation.
   */
  getMissingCheckoutPriceEnvVars(): string[] {
    const missing: string[] = [];
    for (const tier of CHECKOUT_TIERS) {
      for (const interval of BILLING_INTERVALS) {
        if (!isSupportedPlan(tier, interval)) continue;
        const { value, candidates } = resolvePriceEnvVar(tier, interval);
        if (!value) missing.push(candidates[0]);
      }
    }
    return missing;
  }

  /**
   * Get tier name from a Stripe Price ID. Checks every configured
   * (tier, interval) price -- monthly and annual alike -- so both
   * cadences of the same tier resolve identically; unrecognized prices
   * fall back to 'free'.
   */
  getTierFromPriceId(priceId: string): string {
    const match = getConfiguredPricePlans().find(plan => plan.priceId === priceId);
    return match ? match.tier : 'free';
  }
}

export default new StripeService();
