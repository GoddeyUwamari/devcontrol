import Stripe from 'stripe';
import { pool } from '../config/database';
import { TIER_LIMITS, SubscriptionTier } from '../middleware/subscription.middleware';
import { emailService } from './email.service';

export type BillingLifecycleState = 'healthy' | 'grace_period' | 'restricted';

const GRACE_PERIOD_DAYS = 7;

export interface BillingLifecycleRow {
  billingLifecycleState: BillingLifecycleState;
  paymentFailedAt: Date | null;
  gracePeriodEndsAt: Date | null;
}

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

// Refund reasons the client-facing UI offers (components/payments/
// issue-refund-dialog.tsx). Broader than Stripe's own Refund.reason enum --
// see toStripeRefundReason below for the mapping, and STRIPE_REFUND_REASONS
// for which of these actually reach Stripe's `reason` field.
export type RefundReason =
  | 'duplicate'
  | 'fraudulent'
  | 'requested_by_customer'
  | 'service_not_provided'
  | 'product_defective'
  | 'other';

const CLIENT_REFUND_REASONS: readonly RefundReason[] = [
  'duplicate',
  'fraudulent',
  'requested_by_customer',
  'service_not_provided',
  'product_defective',
  'other',
];

export function isRefundReason(value: unknown): value is RefundReason {
  return typeof value === 'string' && (CLIENT_REFUND_REASONS as readonly string[]).includes(value);
}

// Only these three are valid values for Stripe's own Refund.reason field
// (node_modules/stripe/types/Refunds.d.ts) -- the Stripe API rejects any
// other value outright. The UI's other reasons (service_not_provided,
// product_defective, other/custom text) are real, useful admin-facing
// labels but have no Stripe equivalent, so they're preserved verbatim in
// refunds.reason_detail (our own table) and simply never forwarded to
// Stripe's `reason` param -- see StripeController.issueRefund.
const STRIPE_REFUND_REASONS: ReadonlySet<string> = new Set(['duplicate', 'fraudulent', 'requested_by_customer']);

export function toStripeRefundReason(reason: RefundReason): Stripe.RefundCreateParams.Reason | undefined {
  return STRIPE_REFUND_REASONS.has(reason) ? (reason as Stripe.RefundCreateParams.Reason) : undefined;
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
    limit: number = 10,
    startingAfter?: string
  ): Promise<Stripe.Invoice[]> {
    try {
      const invoices = await getStripeClient().invoices.list({
        customer: customerId,
        limit,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
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
   * Retrieve a charge by ID. Used by the refund webhook path to resolve a
   * refund's organization via its charge's customer when the refund itself
   * carries no organizationId metadata (e.g. a refund issued directly in
   * the Stripe Dashboard rather than through POST /api/refunds).
   */
  async retrieveCharge(chargeId: string): Promise<Stripe.Charge> {
    try {
      return await getStripeClient().charges.retrieve(chargeId);
    } catch (error) {
      console.error('Error retrieving charge:', error);
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
   * Retrieve an invoice by id. Callers must independently verify
   * invoice.customer matches the requesting organization's
   * stripe_customer_id before using anything from the result -- this
   * method performs no authorization of its own.
   */
  async getInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    try {
      return await getStripeClient().invoices.retrieve(invoiceId);
    } catch (error) {
      console.error('Error retrieving invoice:', error);
      throw error;
    }
  }

  /**
   * List the InvoicePayment records for an invoice, with each entry's
   * underlying PaymentIntent expanded. This is how a refund/payment target
   * is resolved from an invoice id under the installed Stripe API version
   * (2025-12-15.clover), where Invoice no longer carries a direct
   * payment_intent/charge field of its own -- see
   * node_modules/stripe/types/InvoicePayments.d.ts. `expand:
   * ['data.payment.payment_intent']` is 3 levels deep, within Stripe's
   * 4-level list-expansion limit.
   */
  async listInvoicePayments(invoiceId: string): Promise<Stripe.InvoicePayment[]> {
    try {
      const payments = await getStripeClient().invoicePayments.list({
        invoice: invoiceId,
        expand: ['data.payment.payment_intent'],
      });
      return payments.data;
    } catch (error) {
      console.error('Error listing invoice payments:', error);
      throw error;
    }
  }

  /**
   * Retrieve a PaymentIntent with its latest charge expanded. amount/
   * amount_refunded live on the Charge, not the PaymentIntent, so this is
   * what a caller needs to validate a requested refund amount against what
   * is actually still refundable.
   */
  async getPaymentIntentWithCharge(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    try {
      return await getStripeClient().paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge'],
      });
    } catch (error) {
      console.error('Error retrieving payment intent:', error);
      throw error;
    }
  }

  /**
   * Create a Stripe refund. `params` must already be fully server-resolved
   * (payment_intent, amount, reason) by the caller -- see
   * StripeController.issueRefund, which never forwards a client-supplied
   * Stripe object id or amount without first validating it against the
   * actual PaymentIntent/Charge this organization owns.
   */
  async createRefund(params: Stripe.RefundCreateParams): Promise<Stripe.Refund> {
    try {
      const refund = await getStripeClient().refunds.create(params);
      console.log(`Created refund ${refund.id} for payment intent ${params.payment_intent}`);
      return refund;
    } catch (error) {
      console.error('Error creating refund:', error);
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

  /**
   * Read an organization's current billing lifecycle state. Used both by
   * subscription.middleware.ts's enforcement path and by getSubscription's
   * API response -- the two deliberately different consumers of the same
   * three columns (see recordPaymentFailure/recordPaymentRecovery below for
   * why those columns exist and how they're written).
   */
  async getBillingLifecycleState(organizationId: string): Promise<BillingLifecycleRow | null> {
    const { rows } = await pool.query(
      `SELECT billing_lifecycle_state, payment_failed_at, grace_period_ends_at
       FROM organizations WHERE id = $1`,
      [organizationId]
    );
    if (rows.length === 0) return null;
    return {
      billingLifecycleState: rows[0].billing_lifecycle_state as BillingLifecycleState,
      paymentFailedAt: rows[0].payment_failed_at,
      gracePeriodEndsAt: rows[0].grace_period_ends_at,
    };
  }

  /**
   * Record a payment failure for an organization, idempotently.
   *
   * Only the FIRST failure of a episode (billing_lifecycle_state currently
   * 'healthy') establishes payment_failed_at/grace_period_ends_at and moves
   * the state to 'grace_period' -- a WHERE clause makes this a single
   * conditional UPDATE rather than a read-then-write, so it's race-safe
   * under concurrent webhook delivery too. Every subsequent
   * invoice.payment_failed for the same still-unresolved episode (Stripe's
   * own retry schedule, or a redelivered webhook) matches zero rows and is
   * a pure no-op: the grace deadline never moves, and the caller (see
   * StripeController.handleInvoicePaymentFailed) uses `wasNewFailure` to
   * decide whether to send a notification at all -- so redelivery can never
   * extend the deadline or spam email, without needing a separate webhook
   * event ledger.
   */
  async recordPaymentFailure(organizationId: string): Promise<{ wasNewFailure: boolean; row: BillingLifecycleRow }> {
    const graceEndsAt = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const result = await pool.query(
      `UPDATE organizations
       SET billing_lifecycle_state = 'grace_period',
           payment_failed_at = NOW(),
           grace_period_ends_at = $2
       WHERE id = $1 AND billing_lifecycle_state = 'healthy'
       RETURNING billing_lifecycle_state, payment_failed_at, grace_period_ends_at`,
      [organizationId, graceEndsAt]
    );

    if (result.rows.length > 0) {
      return {
        wasNewFailure: true,
        row: {
          billingLifecycleState: result.rows[0].billing_lifecycle_state,
          paymentFailedAt: result.rows[0].payment_failed_at,
          gracePeriodEndsAt: result.rows[0].grace_period_ends_at,
        },
      };
    }

    // Already in grace_period or restricted -- read back the existing
    // (unchanged) state for the caller rather than re-deriving it.
    const existing = await this.getBillingLifecycleState(organizationId);
    return { wasNewFailure: false, row: existing! };
  }

  /**
   * Record a payment recovery (or an explicit reset, e.g. on subscription
   * cancellation -- see StripeController.handleSubscriptionDeleted),
   * idempotently. A WHERE clause excluding the already-healthy case means
   * calling this when there was never a failure -- the overwhelmingly
   * common case, since every invoice.paid runs through here -- is a
   * zero-row no-op UPDATE, not a rewrite.
   *
   * Returns whether the organization was actually in grace_period/restricted
   * before this call (i.e. whether this was a genuine recovery, as opposed
   * to invoice.paid firing for an already-healthy org, which happens on
   * every normal renewal).
   */
  async recordPaymentRecovery(organizationId: string): Promise<{ wasRecovery: boolean }> {
    const result = await pool.query(
      `UPDATE organizations
       SET billing_lifecycle_state = 'healthy',
           payment_failed_at = NULL,
           grace_period_ends_at = NULL
       WHERE id = $1 AND billing_lifecycle_state != 'healthy'
       RETURNING id`,
      [organizationId]
    );
    return { wasRecovery: result.rows.length > 0 };
  }

  /**
   * Send the payment-failure notification email to the organization's
   * owner, reusing the existing Resend-backed EmailService and the same
   * "org owner" recipient-resolution query already established by
   * weekly-summary.repository.ts's getUserInfo. Never throws (matches
   * EmailService.send's own contract) and never includes any payment
   * credential/card detail -- only the grace deadline and a link to the
   * existing Stripe Customer Portal.
   */
  async sendPaymentFailedEmail(organizationId: string, graceEndsAt: Date): Promise<void> {
    try {
      const { rows } = await pool.query(
        `SELECT u.email, u.full_name, o.name AS organization_name
         FROM organizations o
         JOIN organization_memberships om ON om.organization_id = o.id AND om.role = 'owner'
         JOIN users u ON u.id = om.user_id
         WHERE o.id = $1
         LIMIT 1`,
        [organizationId]
      );

      if (rows.length === 0) {
        console.warn(`[Payment Failure] No owner found to notify for organization ${organizationId}`);
        return;
      }

      await emailService.sendPaymentFailedEmail({
        to: rows[0].email,
        organizationName: rows[0].organization_name || 'Your Organization',
        graceEndsAt,
      });
    } catch (error: any) {
      console.error(`[Payment Failure] Failed to send notification for organization ${organizationId}:`, error.message);
    }
  }
}

export default new StripeService();
