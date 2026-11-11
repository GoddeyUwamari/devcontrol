import Stripe from 'stripe';
import { pool } from '../config/database';
import { TIER_LIMITS, SubscriptionTier } from '../middleware/subscription.middleware';
import { TERMINAL_SUBSCRIPTION_STATUSES, isTerminalSubscriptionStatus } from '../config/subscription-status';
import { safeErrorFields } from '../utils/safe-error-log';
import { emailService } from './email.service';
import { TRIAL_PERIOD_DAYS } from '../config/trial';

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

// The plans a customer can buy or switch to on their own: Cost Control
// (starter) and Optimization Engine (pro). Revenue Protection (enterprise)
// is sales-led: it keeps its Stripe price (PRICE_ENV_VAR_CANDIDATES), so
// getTierFromPriceId still maps every existing Revenue Protection
// subscription to 'enterprise', but neither Checkout nor change-plan will
// start or switch to it, and an organization on it cannot change its plan
// itself.
export const SELF_SERVE_TIERS: readonly CheckoutTier[] = ['starter', 'pro'];

/** A tier with a Stripe price that is sold by the sales team, not self-serve. */
export function isSalesLedTier(value: unknown): boolean {
  return isCheckoutTier(value) && !SELF_SERVE_TIERS.includes(value);
}

/**
 * Whether Checkout and change-plan may target this plan: a self-serve tier
 * at a cadence it is offered in (isSupportedPlan).
 */
export function isSelfServePlan(tier: CheckoutTier, interval: BillingInterval): boolean {
  return SELF_SERVE_TIERS.includes(tier) && isSupportedPlan(tier, interval);
}

/**
 * A change-plan request that would switch billing interval (monthly <->
 * annual) while the subscription is in its free trial. Refused: the trial's
 * end stays fixed, and an interval change would move the billing anchor.
 */
export class TrialIntervalChangeError extends Error {
  constructor() {
    super('Billing interval changes are not available during a trial');
    this.name = 'TrialIntervalChangeError';
  }
}

/** Stripe's recurring interval for a billing interval. */
function stripeIntervalOf(interval: BillingInterval): 'month' | 'year' {
  return interval === 'annual' ? 'year' : 'month';
}

/** Statuses a trialing subscription moves to when its first charge fails. */
const FIRST_CHARGE_FAILURE_STATUSES: readonly string[] = ['past_due', 'unpaid'];

// The terminal statuses (canceled, incomplete_expired) live with the other
// status lists in config/subscription-status.ts, shared with the
// effective-tier decision; re-exported here for the existing importers.
export { TERMINAL_SUBSCRIPTION_STATUSES, isTerminalSubscriptionStatus };

/** A caught Stripe error's name and code, for logs; never its message or the error object, which can quote Stripe ids. */
function stripeErrorKind(error: unknown): { name?: string; code?: string } {
  const { name, code } = safeErrorFields(error);
  return { name, code };
}

/**
 * Which recorded subscription a subscription write may land on.
 *  - 'canonical': only the organization's recorded subscription.
 *  - 'adoptable': the recorded subscription, or a new one when the
 *    organization records none or only a terminal one (subscribing again
 *    after a cancellation). Never a second subscription next to a billable
 *    one.
 * `customerId`, when given, must also be the organization's Stripe customer.
 */
export interface SubscriptionIdentityGuard {
  subscriptionId: string;
  match: 'canonical' | 'adoptable';
  customerId?: string;
}

/** The id of a Stripe reference that may arrive expanded or as a bare id. */
export function stripeIdOf(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
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
   * Create a Stripe customer for an organization. Only creates it in Stripe:
   * the caller records it on the organization, and only if the organization
   * has none yet (checkout-reservation.service attachCustomerIfAbsent), so an
   * organization never ends up pointing at a second customer.
   */
  async createCustomer(
    email: string,
    name: string,
    organizationId: string,
    options: { idempotencyKey: string }
  ): Promise<Stripe.Customer> {
    try {
      const customer = await getStripeClient().customers.create(
        {
          email,
          name,
          metadata: {
            organizationId,
          },
        },
        { idempotencyKey: options.idempotencyKey }
      );

      console.log(`Created Stripe customer for organization ${organizationId}`);
      return customer;
    } catch (error) {
      console.error('Error creating Stripe customer:', stripeErrorKind(error));
      throw error;
    }
  }

  /**
   * Create a Checkout Session for subscription. `expiresAt` (Unix seconds)
   * bounds how long the session can be completed; the caller's reservation
   * outlives it (checkout-reservation.service).
   */
  async createCheckoutSession(
    customerId: string,
    priceId: string,
    organizationId: string,
    successUrl: string,
    cancelUrl: string,
    options: { expiresAt: number; idempotencyKey: string; trial?: boolean }
  ): Promise<Stripe.Checkout.Session> {
    try {
      // The free trial (config/trial.ts): a fixed number of days, never a
      // date, and a card always collected. Should the card be removed before
      // the trial ends, the subscription is canceled rather than paused.
      const trialParams = options.trial
        ? {
            payment_method_collection: 'always' as const,
          }
        : {};
      const trialSubscriptionData = options.trial
        ? {
            trial_period_days: TRIAL_PERIOD_DAYS,
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } },
          }
        : {};
      const session = await getStripeClient().checkout.sessions.create(
        {
          ...trialParams,
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
          expires_at: options.expiresAt,
          metadata: {
            organizationId,
          },
          subscription_data: {
            metadata: {
              organizationId,
            },
            ...trialSubscriptionData,
          },
          allow_promotion_codes: true,
        },
        { idempotencyKey: options.idempotencyKey }
      );

      console.log(`Created checkout session for organization ${organizationId}`);
      return session;
    } catch (error) {
      console.error('Error creating checkout session:', stripeErrorKind(error));
      throw error;
    }
  }

  /** Retrieve a Checkout Session (its status and, while open, its URL). */
  async retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    try {
      return await getStripeClient().checkout.sessions.retrieve(sessionId);
    } catch (error) {
      // Name and code only: a Stripe error message can quote the session id.
      console.error('Error retrieving checkout session:', stripeErrorKind(error));
      throw error;
    }
  }

  /**
   * Expire an open Checkout Session. Stripe only expires a session that is
   * still open; once it returns, the session can never be completed. It
   * throws for a session that has already completed or expired.
   */
  async expireCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    try {
      return await getStripeClient().checkout.sessions.expire(sessionId);
    } catch (error) {
      // Name and code only: a Stripe error message can quote the session id.
      console.error('Error expiring checkout session:', stripeErrorKind(error));
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

      console.log('Created a subscription');
      return subscription;
    } catch (error) {
      console.error('Error creating subscription:', stripeErrorKind(error));
      throw error;
    }
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(
    subscriptionId: string,
    options?: { idempotencyKey: string }
  ): Promise<Stripe.Subscription> {
    try {
      const subscription = options
        ? await getStripeClient().subscriptions.cancel(subscriptionId, {}, { idempotencyKey: options.idempotencyKey })
        : await getStripeClient().subscriptions.cancel(subscriptionId);

      console.log('Canceled a subscription');
      return subscription;
    } catch (error) {
      console.error('Error canceling subscription:', stripeErrorKind(error));
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

      console.log('Set a subscription to cancel at period end');
      return subscription;
    } catch (error) {
      console.error('Error setting subscription to cancel at period end:', stripeErrorKind(error));
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

      console.log('Resumed a subscription');
      return subscription;
    } catch (error) {
      console.error('Error resuming subscription:', stripeErrorKind(error));
      throw error;
    }
  }

  /**
   * Update subscription to a new price/plan
   */
  async updateSubscription(
    subscriptionId: string,
    newPriceId: string,
    requestedInterval?: BillingInterval
  ): Promise<Stripe.Subscription> {
    try {
      // Get current subscription
      const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId);
      const item = subscription.items.data[0];

      // During the free trial: the trial end stays fixed (passed back
      // unchanged), there is nothing to prorate, and the billing interval
      // cannot change (that would move the billing anchor). A tier change
      // within the same interval is allowed.
      const trialing = subscription.status === 'trialing' && typeof subscription.trial_end === 'number';
      if (trialing && requestedInterval !== undefined) {
        const currentInterval = item?.price?.recurring?.interval;
        if (currentInterval !== stripeIntervalOf(requestedInterval)) {
          throw new TrialIntervalChangeError();
        }
      }

      // Update the subscription item with new price
      const updatedSubscription = await getStripeClient().subscriptions.update(subscriptionId, {
        items: [
          {
            id: item.id,
            price: newPriceId,
          },
        ],
        ...(trialing
          ? { proration_behavior: 'none' as const, trial_end: subscription.trial_end as number }
          : { proration_behavior: 'create_prorations' as const }),
      });

      console.log('Updated a subscription to a new price');
      return updatedSubscription;
    } catch (error) {
      if (error instanceof TrialIntervalChangeError) throw error;
      console.error('Error updating subscription:', stripeErrorKind(error));
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
      console.error('Error retrieving upcoming invoice:', stripeErrorKind(error));
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
      console.error('Error listing invoices:', stripeErrorKind(error));
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

      console.log('Created a customer portal session');
      return session;
    } catch (error) {
      console.error('Error creating portal session:', stripeErrorKind(error));
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
      console.error('Error retrieving subscription:', stripeErrorKind(error));
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
      console.error('Error retrieving charge:', stripeErrorKind(error));
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
      console.error('Error retrieving customer:', stripeErrorKind(error));
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
      console.error('Error retrieving invoice:', stripeErrorKind(error));
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
      console.error('Error listing invoice payments:', stripeErrorKind(error));
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
      console.error('Error retrieving payment intent:', stripeErrorKind(error));
      throw error;
    }
  }

  /**
   * Create a Stripe refund. `params` must already be fully server-resolved
   * (payment_intent, amount, reason) by the caller -- see
   * StripeController.issueRefund, which never forwards a client-supplied
   * Stripe object id or amount without first validating it against the
   * actual PaymentIntent/Charge this organization owns.
   *
   * `options.idempotencyKey` is passed straight through to the Stripe SDK
   * (same `refunds.create(params, options)` shape Stripe itself uses) so a
   * caller-computed key -- see StripeController.buildRefundIdempotencyKey --
   * makes retrying this exact call (e.g. after a timed-out response) safe:
   * Stripe returns the original refund instead of creating a duplicate one.
   */
  async createRefund(
    params: Stripe.RefundCreateParams,
    options?: Stripe.RequestOptions
  ): Promise<Stripe.Refund> {
    try {
      const refund = await getStripeClient().refunds.create(params, options);
      console.log('Created a refund');
      return refund;
    } catch (error) {
      console.error('Error creating refund:', stripeErrorKind(error));
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
      console.error('Webhook signature verification failed:', stripeErrorKind(error));
      return null;
    }
  }

  /**
   * Update organization subscription info in database -- the single write
   * path for subscription_tier/subscription_status/stripe_subscription_id/
   * period fields, called from both synchronous controller actions
   * (cancelSubscription, changePlan, resumeSubscription,
   * handleCheckoutSessionCompleted) and asynchronous webhook handlers
   * (handleSubscriptionUpdated, handleSubscriptionDeleted).
   *
   * `ordering.asOf` is REQUIRED, not optional, and gates the entire write
   * (every field in `data`, not just tier) via a single atomic CAS UPDATE
   * against organizations.latest_processed_subscription_event_created_at --
   * closes the P1 where a stale customer.subscription.updated (Stripe does
   * not guarantee webhook delivery order) could resurrect entitlement after
   * a legitimate cancellation, because its own payload is a perfectly valid
   * Subscription snapshot from an earlier point in time; nothing in the
   * payload's own content distinguishes "stale" from "fresh" -- only a
   * comparison against something external (a clock) can.
   *
   * Every caller must pass a real, deliberate `asOf`:
   *  - Webhook handlers pass the Stripe Event envelope's own `created`
   *    (Unix seconds -> Date) -- NOT any field on the Subscription/Checkout
   *    Session payload itself. Subscription.created is fixed at
   *    subscription-creation time and never changes across updates (see
   *    node_modules/stripe/types/Subscriptions.d.ts) -- useless for
   *    comparing one update against another. current_period_start/end
   *    aren't even top-level Subscription fields in the installed API
   *    version. Only the enclosing Event's own `created` increases with
   *    each real, distinct mutation Stripe reports, independent of
   *    delivery order (see node_modules/stripe/types/Events.d.ts).
   *  - Synchronous controller actions pass `new Date()` (this server's
   *    clock), unconditionally accepted (see `allowTie` below is not
   *    needed there -- a synchronous write always advances the mark
   *    forward from whatever it was). This is what closes the *other* half
   *    of the same bug: cancelSubscription/changePlan write tier
   *    synchronously today with no ordering guard at all, so a stale
   *    webhook arriving afterward could resurrect entitlement exactly the
   *    same way even with the two webhook handlers fixed. Safety of mixing
   *    our own clock with Stripe's here rests on ordinary NTP-level clock
   *    sync between our server and Stripe's (sub-second in practice, not
   *    guaranteed to the millisecond) -- the only failure mode from skew is
   *    a *false rejection* of the real confirming webhook for a change we
   *    just made synchronously (our clock briefly ahead of Stripe's), which
   *    is harmless: the state it would have written is already correct, so
   *    the mark simply stops advancing on that one redundant event rather
   *    than any data becoming wrong. Skew can never cause a stale event to
   *    be wrongly *accepted*, only (rarely, harmlessly) cause a fresh one to
   *    be wrongly rejected.
   *
   * `ordering.allowTie` (default false) is the deliberate asymmetry between
   * customer.subscription.updated (strict `>`, a tie is rejected) and
   * customer.subscription.deleted (`allowTie: true`, `>=`, a tie is
   * accepted and wins) -- Stripe Event.created has one-second resolution,
   * so a same-second collision between an .updated and a .deleted fired
   * from the same cancellation is the expected common case, not a rare
   * edge case. Deletion is treated as authoritative/terminal at a tie
   * because no Stripe operation ever "un-deletes" a subscription -- there
   * is no legitimate .updated payload that should ever be trusted over a
   * .deleted at the same instant.
   *
   * Returns `{ applied: false }` (no rows affected, nothing written) when
   * `asOf` was not newer than (or, for deletion, at least as new as) the
   * organization's existing mark -- i.e. this event/action was stale.
   * Callers must check this and skip any downstream effect (e.g.
   * recordPaymentRecovery) that would only be correct if the write actually
   * landed.
   *
   * `identity` (optional) makes the subscription id the identity of the
   * write: the same atomic UPDATE also requires the organization's recorded
   * subscription to be `identity.subscriptionId` ('canonical'), or allows a
   * new one only while the organization records none or only a terminal one
   * ('adoptable'), and optionally requires its Stripe customer to be
   * `identity.customerId`. So an event or action for a subscription that is
   * not the organization's own can never downgrade or overwrite it. A write
   * refused for identity also returns `{ applied: false }`.
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
      /**
       * Not a column: the subscription's trial end (Unix seconds) from the
       * same payload, for the first-charge rule's stale-event guard.
       */
      trialEnd?: number | null;
    },
    ordering: { asOf: Date; allowTie?: boolean },
    identity?: SubscriptionIdentityGuard
  ): Promise<{ applied: boolean }> {
    try {
      // Names the fields only: their values include Stripe ids, which are never logged.
      console.log(`📝 Updating organization ${organizationId} subscription fields: ${Object.keys(data).filter(key => (data as Record<string, unknown>)[key] !== undefined).join(', ') || 'none'}`);

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

      // The first charge after a free trial has no grace period. The one
      // lifecycle state that tells it apart from every later charge is the
      // recorded subscription still being 'trialing' when it fails: Stripe
      // moves a trial to past_due/unpaid only when the invoice at the trial's
      // end is not paid; later charges fail from 'active'. Inside this same
      // UPDATE (so under its ordering and identity guard), a transition of the
      // recorded subscription from 'trialing' (the OLD value: every column
      // reference in SET reads the row before the update) to past_due/unpaid
      // ends paid access at once: 'restricted', with no grace deadline (the
      // marker of this episode, see recordPaymentRecovery). entitlementOf is
      // unchanged and reads it as free with a payment hold; the ordinary
      // payment-failure grace (recordPaymentFailure) never applies here.
      //
      // Stale-event guard (the invoice side of the same discipline PR B uses
      // for subscription events): the transition ends access only while no
      // invoice from the trial's end has been processed yet. Once one has
      // (latest_processed_invoice_created_at at or after a day before the
      // trial end; the only earlier invoice is the $0 one at the trial's
      // start), its own event decided the first charge -- a failure already
      // restricted (recordFirstChargeFailure), a payment already recovered
      // (recordPaymentRecovery) -- so a late trialing -> past_due delivered
      // after the payment can never restrict a paying organization again.
      if (
        data.subscriptionId !== undefined &&
        data.status !== undefined &&
        typeof data.trialEnd === 'number' &&
        FIRST_CHARGE_FAILURE_STATUSES.includes(data.status)
      ) {
        const firstChargeSubscriptionParam = paramIndex++;
        values.push(data.subscriptionId);
        const trialEndParam = paramIndex++;
        values.push(data.trialEnd);
        const firstChargeFailed =
          `(subscription_status = 'trialing' AND stripe_subscription_id = $${firstChargeSubscriptionParam}` +
          ` AND (latest_processed_invoice_created_at IS NULL` +
          ` OR latest_processed_invoice_created_at < to_timestamp($${trialEndParam}::bigint) - interval '1 day'))`;
        updates.push(`billing_lifecycle_state = CASE WHEN ${firstChargeFailed} THEN 'restricted' ELSE billing_lifecycle_state END`);
        updates.push(`payment_failed_at = CASE WHEN ${firstChargeFailed} THEN COALESCE(payment_failed_at, NOW()) ELSE payment_failed_at END`);
        updates.push(`grace_period_ends_at = CASE WHEN ${firstChargeFailed} THEN NULL ELSE grace_period_ends_at END`);
      }

      // A recovered first charge never leaves a paying organization
      // restricted: an applied 'active' (Stripe sets it only once the invoice
      // is paid; the ordering guard refuses an 'active' older than a later
      // event) clears the first-charge restriction ('restricted' with no
      // grace deadline, which only that path writes), whichever of this and
      // the invoice.paid recovery arrives first. The ordinary grace episode
      // (which always has a deadline) is untouched: only invoice.paid ends it.
      if (data.status === 'active') {
        const firstChargeRestricted = `(billing_lifecycle_state = 'restricted' AND grace_period_ends_at IS NULL)`;
        updates.push(`billing_lifecycle_state = CASE WHEN ${firstChargeRestricted} THEN 'healthy' ELSE billing_lifecycle_state END`);
        updates.push(`payment_failed_at = CASE WHEN ${firstChargeRestricted} THEN NULL ELSE payment_failed_at END`);
        updates.push(`payment_failed_notification_sent_at = CASE WHEN ${firstChargeRestricted} THEN NULL ELSE payment_failed_notification_sent_at END`);
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
        return { applied: false };
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);

      // Ordering guard: the same $asOf placeholder is referenced in both
      // the SET clause (advancing the mark) and the WHERE clause (gating
      // the whole write on it) -- one bound value, two references, so the
      // comparison and the write are the same atomic statement. No
      // read-then-write gap: concurrent callers racing on the same
      // organization serialize on Postgres's own row lock for this UPDATE,
      // and whichever commits first is what every later comparison is
      // evaluated against.
      const asOfParamIndex = paramIndex++;
      values.push(ordering.asOf);
      updates.push(`latest_processed_subscription_event_created_at = $${asOfParamIndex}`);

      const idParamIndex = paramIndex++;
      values.push(organizationId);

      const comparisonOperator = ordering.allowTie ? '<=' : '<';

      // Identity: the same statement as the ordering guard, so the check and
      // the write cannot be separated by a concurrent write.
      const identityPredicates: string[] = [];
      if (identity) {
        const subscriptionParamIndex = paramIndex++;
        values.push(identity.subscriptionId);
        if (identity.match === 'canonical') {
          identityPredicates.push(`stripe_subscription_id = $${subscriptionParamIndex}`);
        } else {
          const terminalParamIndex = paramIndex++;
          values.push(TERMINAL_SUBSCRIPTION_STATUSES);
          identityPredicates.push(
            `(stripe_subscription_id IS NULL
              OR stripe_subscription_id = $${subscriptionParamIndex}
              OR COALESCE(subscription_status, '') = ANY($${terminalParamIndex}::text[]))`
          );
        }
        if (identity.customerId !== undefined) {
          const customerParamIndex = paramIndex++;
          values.push(identity.customerId);
          identityPredicates.push(`stripe_customer_id = $${customerParamIndex}`);
        }
      }

      const query = `
        UPDATE organizations
        SET ${updates.join(', ')}
        WHERE id = $${idParamIndex}
          AND (
            latest_processed_subscription_event_created_at IS NULL
            OR latest_processed_subscription_event_created_at ${comparisonOperator} $${asOfParamIndex}
          )${identityPredicates.map(p => `\n          AND ${p}`).join('')}
      `;

      // The statement only; its bound values (Stripe ids among them) are never logged.
      console.log(`🔍 SQL Query: ${query}`);

      const result = await pool.query(query, values);
      const applied = (result.rowCount ?? 0) > 0;

      if (!applied) {
        console.log(`⚠️ Subscription write not applied for organization ${organizationId} (asOf=${ordering.asOf.toISOString()}): stale against the recorded mark${identity ? ', or not the organization\'s own subscription' : ''}`);
      } else {
        console.log(`✅ Database update result: ${result.rowCount} row(s) affected`);
        console.log(`✅ Updated organization ${organizationId} subscription info`);
      }

      return { applied };
    } catch (error) {
      console.error('❌ Error updating organization subscription:', stripeErrorKind(error));
      throw error;
    }
  }

  /**
   * Claim the organization's one free trial for `subscriptionId`, a
   * subscription already verified as the organization's own (under its
   * customer, metadata naming it) on which Stripe shows a trial. One atomic
   * statement: only the first claim lands, and trial_used_at is never
   * cleared, so a canceled trial still uses up the organization's trial.
   *  - 'claimed': this call consumed the trial;
   *  - 'this_subscription': it was already consumed by this subscription
   *    (a redelivery or a second event for it);
   *  - 'other_subscription': it was consumed before, by another subscription;
   *  - 'not_found': no such organization under that customer.
   */
  async claimTrial(
    organizationId: string,
    customerId: string,
    subscriptionId: string
  ): Promise<'claimed' | 'this_subscription' | 'other_subscription' | 'not_found'> {
    const claimed = await pool.query(
      `UPDATE organizations
          SET trial_used_at = NOW(), trial_subscription_id = $3
        WHERE id = $1 AND stripe_customer_id = $2 AND trial_used_at IS NULL
        RETURNING id`,
      [organizationId, customerId, subscriptionId]
    );
    if ((claimed.rowCount ?? 0) > 0) return 'claimed';
    const { rows } = await pool.query(
      'SELECT trial_subscription_id FROM organizations WHERE id = $1 AND stripe_customer_id = $2',
      [organizationId, customerId]
    );
    if (rows.length === 0) return 'not_found';
    return rows[0].trial_subscription_id === subscriptionId ? 'this_subscription' : 'other_subscription';
  }

  /**
   * The invoice half of the first-charge rule (see updateOrganizationSubscription
   * for the subscription half): an invoice of the organization's recorded
   * subscription failed while that subscription is still recorded as
   * 'trialing', so it is the first charge after the trial. Access ends at
   * once ('restricted', no grace deadline); no payment-failure email of ours
   * is sent (Stripe's own covers it). Strictly newer than the last processed
   * invoice event only, so a late failure of an invoice that has since been
   * paid can never end access here. Returns whether it applied; when it did
   * not, the caller continues with the ordinary path (recordPaymentFailure).
   */
  async recordFirstChargeFailure(
    organizationId: string,
    subscriptionId: string,
    invoiceCreatedAt: Date
  ): Promise<boolean> {
    const result = await pool.query(
      `UPDATE organizations
          SET billing_lifecycle_state = 'restricted',
              payment_failed_at = NOW(),
              grace_period_ends_at = NULL,
              latest_processed_invoice_created_at = $3,
              payment_failed_notification_sent_at = NULL
        WHERE id = $1
          AND stripe_subscription_id = $2
          AND subscription_status = 'trialing'
          AND billing_lifecycle_state = 'healthy'
          AND (latest_processed_invoice_created_at IS NULL OR latest_processed_invoice_created_at < $3)
        RETURNING id`,
      [organizationId, subscriptionId, invoiceCreatedAt]
    );
    return (result.rowCount ?? 0) > 0;
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
      console.error('Error getting organization by customer ID:', stripeErrorKind(error));
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
   * The tier a subscription snapshot grants: 'free' once it is terminal
   * (canceled / incomplete_expired: its items still name the old, or
   * never-paid, price), otherwise the tier of its price. Used by every
   * webhook path that writes a tier from a subscription, so a late or
   * re-read terminal subscription can never write a paid tier.
   */
  tierForSubscription(subscription: { status?: string; items?: { data?: Array<{ price?: { id?: string } }> } }): string {
    if (isTerminalSubscriptionStatus(subscription.status)) return 'free';
    const priceId = subscription.items?.data?.[0]?.price?.id;
    return priceId ? this.getTierFromPriceId(priceId) : 'free';
  }

  /**
   * Read an organization's current billing lifecycle state. Used both by
   * subscription.middleware.ts's enforcement path and by getSubscription's
   * API response -- the two deliberately different consumers of the same
   * columns (see recordPaymentFailure/recordPaymentRecovery below for why
   * those columns exist and how they're written).
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
   * Record a payment failure for an organization, idempotently and safe
   * against out-of-order webhook delivery.
   *
   * `invoiceCreatedAt` is the failing invoice's own Invoice.created (Unix
   * seconds -> Date; see node_modules/stripe/types/Invoices.d.ts) -- the
   * only invoice-identity timestamp present and non-null on every
   * invoice.payment_failed *and* invoice.paid payload, which is what makes
   * it usable as a single shared ordering key across both directions of
   * this lifecycle. Stripe explicitly does not guarantee webhook delivery
   * order, so this is not a defensive nicety: an invoice.payment_failed for
   * an invoice OLDER than the newest one this organization has already
   * processed (tracked in latest_processed_invoice_created_at) is rejected
   * outright as stale, even if the organization is currently 'healthy' --
   * otherwise a delayed, out-of-order failure notification for an invoice
   * that predates a genuine recovery could incorrectly reopen a grace
   * period for an organization that has already paid.
   *
   * Starting an episode needs a STRICTLY newer invoice (`<`). Every payment
   * attempt on one invoice carries that invoice's same `created`, so once
   * any event of the invoice has been processed, a failure of the same
   * invoice arriving later compares equal. While the organization is
   * 'healthy' that equal failure is stale: either the invoice's own
   * invoice.paid has already been processed (a paid invoice is final, so
   * this is a late earlier attempt), or the episode already ended another
   * way (the subscription was deleted, or the first-charge restriction was
   * cleared by an 'active' update, which Stripe sets only once paid). It
   * never opens a grace period and is reported `wasStale`. An equal
   * failure while NOT healthy is not stale: it is Stripe's next attempt on
   * the invoice of the open episode, and may still owe the notification.
   * (recordPaymentRecovery keeps `<=`: an invoice paid after its own
   * failure must end that failure's episode.)
   *
   * The primary UPDATE below only fires for the actual first failure of a
   * new episode (billing_lifecycle_state currently 'healthy') AND a
   * non-stale invoice -- a single conditional UPDATE, not a read-then-write,
   * so it's race-safe under concurrent webhook delivery. Every subsequent
   * invoice.payment_failed for the same still-unresolved episode (Stripe's
   * own retry schedule, or a redelivered webhook) matches zero rows and is
   * a no-op there: the grace deadline never moves, and the caller (see
   * StripeController.handleInvoicePaymentFailed) uses `wasNewFailure` to
   * decide whether to send a notification at all -- so redelivery can
   * never extend the deadline or spam email, without needing a separate
   * webhook event ledger. If that first UPDATE doesn't fire, a second,
   * independently-guarded UPDATE advances the high-water mark alone (no
   * deadline/notification effect) for the case of a genuinely newer
   * invoice also failing while the organization is already in an
   * unresolved episode -- this keeps future staleness comparisons accurate
   * without needing to re-derive them from anything but this column.
   */
  async recordPaymentFailure(
    organizationId: string,
    invoiceCreatedAt: Date
  ): Promise<{ wasNewFailure: boolean; wasStale: boolean; row: BillingLifecycleRow; notificationPending: boolean }> {
    const graceEndsAt = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    // payment_failed_notification_sent_at is reset to NULL here even though
    // it should already be NULL from the prior episode's recovery -- a
    // defensive reset, not a load-bearing one, so a brand-new episode can
    // never inherit a stale "already notified" state if that clearing was
    // ever missed elsewhere. See StripeService.markPaymentFailedNotificationSent
    // for where this column is actually set, and StripeController.
    // handleInvoicePaymentFailed for how notificationPending drives whether
    // a notification is attempted.
    const primary = await pool.query(
      `UPDATE organizations
       SET billing_lifecycle_state = 'grace_period',
           payment_failed_at = NOW(),
           grace_period_ends_at = $2,
           latest_processed_invoice_created_at = $3,
           payment_failed_notification_sent_at = NULL
       WHERE id = $1
         AND billing_lifecycle_state = 'healthy'
         AND (latest_processed_invoice_created_at IS NULL OR latest_processed_invoice_created_at < $3)
       RETURNING billing_lifecycle_state, payment_failed_at, grace_period_ends_at, payment_failed_notification_sent_at`,
      [organizationId, graceEndsAt, invoiceCreatedAt]
    );

    if (primary.rows.length > 0) {
      return {
        wasNewFailure: true,
        wasStale: false,
        row: {
          billingLifecycleState: primary.rows[0].billing_lifecycle_state,
          paymentFailedAt: primary.rows[0].payment_failed_at,
          gracePeriodEndsAt: primary.rows[0].grace_period_ends_at,
        },
        notificationPending: true, // just reset to NULL above, in the same statement -- always pending for a freshly-started episode
      };
    }

    // Not the primary path: either already in an unresolved episode, or
    // this invoice is stale relative to one already processed (or both).
    // If it's a genuinely newer invoice failing while already non-healthy,
    // advance the high-water mark only -- deadline/notification-marker
    // untouched, since this branch never represents a fresh episode.
    await pool.query(
      `UPDATE organizations
       SET latest_processed_invoice_created_at = $2
       WHERE id = $1
         AND billing_lifecycle_state != 'healthy'
         AND (latest_processed_invoice_created_at IS NULL OR latest_processed_invoice_created_at < $2)`,
      [organizationId, invoiceCreatedAt]
    );

    const existing = await pool.query(
      `SELECT billing_lifecycle_state, payment_failed_at, grace_period_ends_at,
              latest_processed_invoice_created_at, payment_failed_notification_sent_at
       FROM organizations WHERE id = $1`,
      [organizationId]
    );
    const row = existing.rows[0];
    const currentMark: Date | null = row?.latest_processed_invoice_created_at ?? null;
    const markTime = currentMark === null ? null : new Date(currentMark).getTime();
    // Older than the mark, or equal to it while healthy (see above).
    const wasStale =
      markTime !== null &&
      (invoiceCreatedAt.getTime() < markTime ||
        (invoiceCreatedAt.getTime() === markTime && row.billing_lifecycle_state === 'healthy'));

    // Pending exactly when this organization is still in an unresolved
    // grace-period episode AND no notification has been confirmed sent for
    // it yet -- this is what lets a genuine retry (Stripe's own dunning
    // schedule redelivering invoice.payment_failed for the same still-open
    // episode, or a redelivered webhook after a crash) recover a
    // notification that never actually went out, without resending one
    // that already did.
    const notificationPending =
      row.billing_lifecycle_state === 'grace_period' && row.payment_failed_notification_sent_at === null;

    return {
      wasNewFailure: false,
      wasStale,
      row: {
        billingLifecycleState: row.billing_lifecycle_state,
        paymentFailedAt: row.payment_failed_at,
        gracePeriodEndsAt: row.grace_period_ends_at,
      },
      notificationPending,
    };
  }

  /**
   * Record a payment recovery, idempotently and safe against out-of-order
   * webhook delivery -- the inverse of recordPaymentFailure, and guarded by
   * the exact same latest_processed_invoice_created_at high-water mark (see
   * that method's comment for why Invoice.created is the right shared
   * ordering key). Also clears payment_failed_notification_sent_at (both
   * branches below) -- once recovered, that column's value describes a
   * resolved episode and must not carry forward into whatever the next,
   * distinct failure episode turns out to be. An invoice.paid for an
   * invoice OLDER than the newest one already processed is rejected
   * outright, even though the organization is currently non-healthy --
   * otherwise a delayed, out-of-order paid event
   * for an invoice that predates a genuine, newer failure could incorrectly
   * clear a grace period the organization is still actually in.
   *
   * `invoiceCreatedAt` is optional: pass it for an invoice.paid-driven
   * recovery (see StripeController.handleInvoicePaid), and omit it for an
   * unconditional reset with no invoice context at all -- currently only
   * subscription cancellation/deletion (StripeController.
   * handleSubscriptionDeleted), which is authoritative regardless of any
   * invoice-ordering concern: there is no paid subscription left to protect
   * once it's canceled, so no staleness check applies there.
   *
   * Returns whether the organization was actually in grace_period/restricted
   * before this call (i.e. whether this was a genuine recovery, as opposed
   * to invoice.paid firing for an already-healthy org, which happens on
   * every normal renewal -- the overwhelmingly common case).
   */
  async recordPaymentRecovery(
    organizationId: string,
    invoiceCreatedAt?: Date
  ): Promise<{ wasRecovery: boolean; wasStale: boolean }> {
    if (!invoiceCreatedAt) {
      // Except a first-charge failure after a trial ('restricted' with no
      // grace deadline, which only that path writes): it stays, so a late
      // invoice.payment_failed for that never-paid first invoice, delivered
      // after the deletion, finds the organization not 'healthy' and can
      // never open a grace period or send the grace email. Access is
      // unaffected (a terminal recorded subscription is free with no hold,
      // entitlementOf step 1), and a later paid invoice of a new subscription
      // clears it (the invoice branch below).
      const result = await pool.query(
        `UPDATE organizations
         SET billing_lifecycle_state = 'healthy',
             payment_failed_at = NULL,
             grace_period_ends_at = NULL,
             payment_failed_notification_sent_at = NULL
         WHERE id = $1 AND billing_lifecycle_state != 'healthy'
           AND NOT (billing_lifecycle_state = 'restricted' AND grace_period_ends_at IS NULL)
         RETURNING id`,
        [organizationId]
      );
      return { wasRecovery: result.rows.length > 0, wasStale: false };
    }

    const primary = await pool.query(
      `UPDATE organizations
       SET billing_lifecycle_state = 'healthy',
           payment_failed_at = NULL,
           grace_period_ends_at = NULL,
           payment_failed_notification_sent_at = NULL,
           latest_processed_invoice_created_at = $2
       WHERE id = $1
         AND billing_lifecycle_state != 'healthy'
         AND (latest_processed_invoice_created_at IS NULL OR latest_processed_invoice_created_at <= $2)
       RETURNING id`,
      [organizationId, invoiceCreatedAt]
    );

    if (primary.rows.length > 0) {
      return { wasRecovery: true, wasStale: false };
    }

    // Not the primary path: either already healthy (the common case -- a
    // normal renewal), or this invoice is stale relative to a newer
    // failure/recovery already processed. Advance the high-water mark only
    // when already healthy and the invoice is genuinely newer -- this is
    // what lets a later stale FAILURE for an even older invoice be
    // correctly rejected; it must never fire while non-healthy, or it would
    // silently erase the evidence a newer failure is still unresolved.
    await pool.query(
      `UPDATE organizations
       SET latest_processed_invoice_created_at = $2
       WHERE id = $1
         AND billing_lifecycle_state = 'healthy'
         AND (latest_processed_invoice_created_at IS NULL OR latest_processed_invoice_created_at < $2)`,
      [organizationId, invoiceCreatedAt]
    );

    const existing = await pool.query(
      `SELECT latest_processed_invoice_created_at FROM organizations WHERE id = $1`,
      [organizationId]
    );
    const currentMark: Date | null = existing.rows[0]?.latest_processed_invoice_created_at ?? null;
    const wasStale = currentMark !== null && invoiceCreatedAt.getTime() < new Date(currentMark).getTime();

    return { wasRecovery: false, wasStale };
  }

  /**
   * Send the payment-failure notification email to the organization's
   * owner, reusing the existing Resend-backed EmailService and the same
   * "org owner" recipient-resolution query already established by
   * weekly-summary.repository.ts's getUserInfo. Never throws (matches
   * EmailService.send's own contract) and never includes any payment
   * credential/card detail -- only the grace deadline and a link to the
   * existing Stripe Customer Portal.
   *
   * Returns whether delivery was actually confirmed -- `true` only when
   * emailService.sendPaymentFailedEmail itself reports success (a real
   * Resend confirmation, not merely "we tried"); `false` for a missing
   * owner, any thrown error, or a Resend-reported failure. The caller
   * (StripeController.handleInvoicePaymentFailed) uses this to decide
   * whether to call markPaymentFailedNotificationSent -- this method
   * itself never touches that column, so a caller that ignores the return
   * value (there is none left in this codebase) simply gets the previous
   * fire-and-forget behavior with no notification-tracking side effect.
   */
  async sendPaymentFailedEmail(organizationId: string, graceEndsAt: Date): Promise<boolean> {
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
        return false;
      }

      return await emailService.sendPaymentFailedEmail({
        to: rows[0].email,
        organizationName: rows[0].organization_name || 'Your Organization',
        graceEndsAt,
      });
    } catch (error: any) {
      console.error(`[Payment Failure] Failed to send notification for organization ${organizationId}:`, error.message);
      return false;
    }
  }

  /**
   * Marks the payment-failure notification as confirmed-delivered for this
   * organization's CURRENT unresolved episode -- called only after
   * sendPaymentFailedEmail has returned `true`. The WHERE clause is a CAS
   * guard, not merely a filter: it only ever writes NOW() over a NULL
   * value, and only while the episode it applies to is still open
   * (billing_lifecycle_state = 'grace_period') -- if a recovery raced in
   * between the send succeeding and this call running, there is no longer
   * a relevant episode for this timestamp to describe, so this is
   * correctly a no-op rather than stamping a resolved/irrelevant episode.
   */
  async markPaymentFailedNotificationSent(organizationId: string): Promise<void> {
    await pool.query(
      `UPDATE organizations
       SET payment_failed_notification_sent_at = NOW()
       WHERE id = $1
         AND billing_lifecycle_state = 'grace_period'
         AND payment_failed_notification_sent_at IS NULL`,
      [organizationId]
    );
  }
}

export default new StripeService();
