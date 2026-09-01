/**
 * Stripe Controller
 * Handles Stripe payment and subscription HTTP requests
 */

import { Request, Response } from 'express';
import Stripe from 'stripe';
import type { PoolClient } from 'pg';
import stripeService, {
  isCheckoutTier,
  isBillingInterval,
  isSupportedPlan,
  isRefundReason,
  toStripeRefundReason,
  CHECKOUT_TIERS,
  BILLING_INTERVALS,
} from '../services/stripe.service';
import { pool } from '../config/database';
import { runWithOrgClient } from '../middleware/auth.middleware';
import { claimWebhookEvent, resolveWebhookEvent } from '../services/stripe-webhook-ledger.service';

// The only fields POST /api/refunds accepts from the client. `paymentId` is
// our own Payment.id, i.e. a Stripe invoice id -- never a payment_intent or
// charge id -- and is independently resolved/validated server-side against
// this organization's Stripe customer before anything is refunded. See
// issueRefund.
const ALLOWED_REFUND_FIELDS = new Set(['paymentId', 'amount', 'reason']);

// The only fields Checkout accepts from the client. Anything else --
// priceId, customerId, subscriptionId, amount, currency, line items,
// successUrl/cancelUrl, etc. -- is rejected outright rather than silently
// ignored, so an attempted bypass is observable (400) and testable instead
// of quietly having no effect.
const ALLOWED_CHECKOUT_FIELDS = new Set(['tier', 'billingInterval']);

export class StripeController {
  /**
   * Billing mutations (cancel, resume, change plan, open the Customer
   * Portal) are restricted to organization owners/admins -- members and
   * viewers can still read billing state (getSubscription/getInvoices)
   * but must not be able to mutate the whole organization's subscription.
   * Role comes exclusively from req.user.role, set server-side by
   * authenticate() from the verified JWT -- never from the request body,
   * query string, or headers. Mirrors the existing requireAdminOrOwner
   * inline-helper convention (see remediation.routes.ts,
   * cost-recommendations.routes.ts) rather than route-level middleware,
   * so it's exercised the same way every other validation in this
   * controller already is, and still protects the method if it's ever
   * called directly.
   */
  private requireBillingAdmin(req: Request, res: Response): boolean {
    const role = req.user?.role;
    if (role !== 'owner' && role !== 'admin') {
      res.status(403).json({
        success: false,
        error: 'Only organization owners and admins can manage billing.',
      });
      return false;
    }
    return true;
  }

  /**
   * POST /api/stripe/create-checkout-session
   * Create a Stripe Checkout session for subscription
   */
  async createCheckoutSession(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      // The server is authoritative here: only a known tier + billing
      // interval are accepted from the client. The Stripe Price ID and the
      // success/cancel URLs are resolved/fixed server-side and are never
      // taken from the request body -- this prevents a caller from
      // checking out against an arbitrary price or redirecting elsewhere.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const disallowedFields = Object.keys(body).filter(key => !ALLOWED_CHECKOUT_FIELDS.has(key));
      if (disallowedFields.length > 0) {
        res.status(400).json({
          success: false,
          error: `Unsupported field(s): ${disallowedFields.join(', ')}. Only "tier" and "billingInterval" are accepted.`,
        });
        return;
      }

      const { tier, billingInterval } = body;
      const organizationId = req.user.organizationId;

      if (!isCheckoutTier(tier)) {
        res.status(400).json({
          success: false,
          error: `A valid subscription tier is required (${CHECKOUT_TIERS.join(', ')})`,
        });
        return;
      }

      if (!isBillingInterval(billingInterval)) {
        res.status(400).json({
          success: false,
          error: `A valid billing interval is required (${BILLING_INTERVALS.join(', ')})`,
        });
        return;
      }

      if (!isSupportedPlan(tier, billingInterval)) {
        res.status(400).json({
          success: false,
          error: 'Enterprise does not support self-service annual billing. Contact sales for annual Enterprise pricing.',
        });
        return;
      }

      if (!organizationId) {
        res.status(400).json({
          success: false,
          error: 'Organization ID is required',
        });
        return;
      }

      // Get organization details
      const orgResult = await pool.query(
        'SELECT id, name, stripe_customer_id FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (orgResult.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      const organization = orgResult.rows[0];
      let customerId = organization.stripe_customer_id;

      // Create Stripe customer if doesn't exist
      if (!customerId) {
        const customer = await stripeService.createCustomer(
          req.user.email || `org-${organizationId}@devcontrol.com`,
          organization.name,
          organizationId
        );
        customerId = customer.id;
      }

      let priceId: string;
      try {
        priceId = stripeService.getPriceIdForPlan(tier, billingInterval);
      } catch (error) {
        console.error(`Checkout plan "${tier}/${billingInterval}" is not configured:`, error);
        res.status(500).json({
          success: false,
          error: 'Checkout is not available for this plan right now',
        });
        return;
      }

      // Fixed, server-controlled redirect targets -- never taken from the
      // request body.
      const successUrl = `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${process.env.FRONTEND_URL}/billing/cancel`;

      // Create checkout session
      const session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        organizationId,
        successUrl,
        cancelUrl
      );

      res.status(200).json({
        success: true,
        data: {
          sessionId: session.id,
          url: session.url,
        },
      });
    } catch (error: any) {
      console.error('Error creating checkout session:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create checkout session',
      });
    }
  }

  /**
   * POST /api/stripe/customer-portal
   * Create a Stripe Customer Portal session
   */
  async createCustomerPortal(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      if (!this.requireBillingAdmin(req, res)) return;

      const { returnUrl } = req.body;
      const organizationId = req.user.organizationId;

      if (!organizationId) {
        res.status(400).json({
          success: false,
          error: 'Organization ID is required',
        });
        return;
      }

      // Get organization with Stripe customer ID
      const orgResult = await pool.query(
        'SELECT stripe_customer_id FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (orgResult.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      const customerId = orgResult.rows[0].stripe_customer_id;

      if (!customerId) {
        res.status(400).json({
          success: false,
          error: 'No Stripe customer found. Please subscribe first.',
        });
        return;
      }

      // Create portal session
      const session = await stripeService.createPortalSession(
        customerId,
        returnUrl || `${process.env.FRONTEND_URL}/billing`
      );

      res.status(200).json({
        success: true,
        data: {
          url: session.url,
        },
      });
    } catch (error: any) {
      console.error('Error creating customer portal session:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to create customer portal session',
      });
    }
  }

  /**
   * GET /api/stripe/subscription
   * Get current subscription details
   */
  async getSubscription(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const organizationId = req.user.organizationId;

      // Get organization subscription details
      const orgResult = await pool.query(
        `SELECT
          stripe_customer_id,
          stripe_subscription_id,
          subscription_status,
          subscription_tier,
          subscription_current_period_start,
          subscription_current_period_end,
          subscription_cancel_at_period_end,
          billing_lifecycle_state,
          payment_failed_at,
          grace_period_ends_at
         FROM organizations
         WHERE id = $1`,
        [organizationId]
      );

      if (orgResult.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: 'Organization not found',
        });
        return;
      }

      const organization = orgResult.rows[0];

      // Derived, read-only view of the payment-failure lifecycle (see
      // subscription.middleware.ts for the actual enforcement -- this is
      // display data only). `tier` elsewhere in this response always stays
      // the organization's real paid tier, even while restricted --
      // billing/tier information must never be silently hidden from the
      // customer, only the underlying access.
      const toEpochSeconds = (value: unknown): number | null =>
        value ? Math.floor(new Date(value as string).getTime() / 1000) : null;
      const gracePeriodEndsAt = organization.grace_period_ends_at as string | null;
      const isRestricted = organization.billing_lifecycle_state === 'restricted' ||
        (organization.billing_lifecycle_state === 'grace_period' &&
          gracePeriodEndsAt !== null &&
          new Date(gracePeriodEndsAt).getTime() < Date.now());
      const billingLifecycle = {
        billingLifecycleState: organization.billing_lifecycle_state,
        paymentFailedAt: toEpochSeconds(organization.payment_failed_at),
        graceEndsAt: toEpochSeconds(organization.grace_period_ends_at),
        isRestricted,
      };

      // If no subscription, return free tier
      if (!organization.stripe_subscription_id) {
        res.status(200).json({
          success: true,
          data: {
            tier: 'free',
            status: 'active',
            cancelAtPeriodEnd: false,
            ...billingLifecycle,
          },
        });
        return;
      }

      // Get full subscription details from Stripe
      let subscription;
      try {
        subscription = await stripeService.getSubscription(
          organization.stripe_subscription_id
        );
      } catch (stripeError: any) {
        console.warn('Could not fetch subscription from Stripe:', stripeError.message);
        res.status(200).json({
          success: true,
          data: {
            tier: organization.subscription_tier || 'free',
            status: 'active',
            cancelAtPeriodEnd: false,
            ...billingLifecycle,
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          id: subscription.id,
          status: subscription.status,
          tier: organization.subscription_tier,
          currentPeriodStart: (subscription as any).current_period_start,
          currentPeriodEnd: (subscription as any).current_period_end,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          cancelAt: subscription.cancel_at,
          ...billingLifecycle,
        },
      });
    } catch (error: any) {
      console.error('Error getting subscription:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get subscription',
      });
    }
  }

  /**
   * POST /api/stripe/cancel-subscription
   * Cancel the current subscription
   */
  async cancelSubscription(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      if (!this.requireBillingAdmin(req, res)) return;

      const organizationId = req.user.organizationId;
      const { immediate } = req.body; // If true, cancel immediately; otherwise, at period end

      // Get organization subscription
      const orgResult = await pool.query(
        'SELECT stripe_subscription_id, subscription_status FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (orgResult.rows.length === 0 || !orgResult.rows[0].stripe_subscription_id) {
        res.status(400).json({
          success: false,
          error: 'No active subscription found',
        });
        return;
      }

      // Idempotent short-circuit for a duplicate immediate-cancel request:
      // Stripe rejects re-canceling a subscription that's already fully
      // canceled (an invalid_request_error), which would otherwise surface
      // as a spurious failure for what is, from the caller's perspective, a
      // harmless retry (e.g. a duplicate click, or a request that raced the
      // one that already succeeded). Report the current, already-canceled
      // state directly instead of calling Stripe again. Not needed for the
      // cancel-at-period-end path -- Stripe's own
      // cancel_at_period_end=true update is naturally idempotent.
      if (immediate && orgResult.rows[0].subscription_status === 'canceled') {
        res.status(200).json({
          success: true,
          data: { status: 'canceled', cancelAtPeriodEnd: false, cancelAt: null },
        });
        return;
      }

      const subscriptionId = orgResult.rows[0].stripe_subscription_id;

      // Cancel subscription
      let subscription;
      if (immediate) {
        subscription = await stripeService.cancelSubscription(subscriptionId);
      } else {
        subscription = await stripeService.cancelSubscriptionAtPeriodEnd(subscriptionId);
      }

      // Update database. The local entitlement projection must transition
      // synchronously with a successful *immediate* cancellation -- Stripe
      // has already fully canceled the subscription by the time this call
      // returns, so the organization must not retain paid-tier access
      // until customer.subscription.deleted eventually arrives (webhook
      // delivery is asynchronous, not instantaneous, and can be delayed by
      // Stripe's own retry backoff if our endpoint is briefly unreachable).
      // Only reached after the Stripe call above has actually succeeded --
      // if it throws, this is never reached and no local state changes,
      // which is what keeps a failed Stripe cancellation from ever
      // desynchronizing local entitlement.
      //
      // customer.subscription.deleted (see handleSubscriptionDeleted below)
      // remains the reconciliation/confirmation path for this, and is
      // idempotent against it: updateOrganizationSubscription only
      // rewrites tier/limits when the tier is actually changing, so the
      // webhook re-asserting 'free' after this call already set it is a
      // no-op there. It's also still the *sole* correction path if this
      // synchronous update never runs at all (e.g. a crash between the
      // Stripe call succeeding and this write) -- that handler doesn't
      // depend on this one having run.
      //
      // cancel-at-period-end intentionally does NOT downgrade the tier
      // here (`tier: undefined` leaves it untouched) -- the organization
      // correctly keeps paid access until the period actually ends, and
      // that transition remains driven by Stripe's own scheduled
      // cancellation firing customer.subscription.updated/.deleted later.
      // asOf: new Date() -- this is a synchronous, authoritative write: the
      // Stripe API call just above already confirmed this state server-side,
      // so it's always at least as fresh as anything a webhook could report
      // about the same change, and it still advances the ordering mark so a
      // later stale customer.subscription.updated can't undo it (see
      // StripeService.updateOrganizationSubscription).
      await stripeService.updateOrganizationSubscription(organizationId, {
        status: subscription.status,
        tier: immediate ? 'free' : undefined,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      }, { asOf: new Date() });

      res.status(200).json({
        success: true,
        data: {
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          cancelAt: subscription.cancel_at,
        },
      });
    } catch (error: any) {
      console.error('Error canceling subscription:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to cancel subscription',
      });
    }
  }

  /**
   * POST /api/stripe/change-plan
   * Upgrade or downgrade an existing subscription's tier and/or billing
   * interval. Same server-authoritative validation as
   * createCheckoutSession -- only tier + billingInterval are accepted from
   * the client, and the target Price ID is resolved server-side via
   * getPriceIdForPlan, never taken from the request body.
   */
  async changePlan(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      if (!this.requireBillingAdmin(req, res)) return;

      const body = (req.body ?? {}) as Record<string, unknown>;
      const disallowedFields = Object.keys(body).filter(key => !ALLOWED_CHECKOUT_FIELDS.has(key));
      if (disallowedFields.length > 0) {
        res.status(400).json({
          success: false,
          error: `Unsupported field(s): ${disallowedFields.join(', ')}. Only "tier" and "billingInterval" are accepted.`,
        });
        return;
      }

      const { tier, billingInterval } = body;
      const organizationId = req.user.organizationId;

      if (!isCheckoutTier(tier)) {
        res.status(400).json({
          success: false,
          error: `A valid subscription tier is required (${CHECKOUT_TIERS.join(', ')})`,
        });
        return;
      }

      if (!isBillingInterval(billingInterval)) {
        res.status(400).json({
          success: false,
          error: `A valid billing interval is required (${BILLING_INTERVALS.join(', ')})`,
        });
        return;
      }

      if (!isSupportedPlan(tier, billingInterval)) {
        res.status(400).json({
          success: false,
          error: 'Enterprise does not support self-service annual billing. Contact sales for annual Enterprise pricing.',
        });
        return;
      }

      if (!organizationId) {
        res.status(400).json({
          success: false,
          error: 'Organization ID is required',
        });
        return;
      }

      // Get organization's existing subscription
      const orgResult = await pool.query(
        'SELECT stripe_subscription_id FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (orgResult.rows.length === 0 || !orgResult.rows[0].stripe_subscription_id) {
        res.status(400).json({
          success: false,
          error: 'No active subscription found. Use create-checkout-session to start a new subscription.',
        });
        return;
      }

      const subscriptionId = orgResult.rows[0].stripe_subscription_id;

      let newPriceId: string;
      try {
        newPriceId = stripeService.getPriceIdForPlan(tier, billingInterval);
      } catch (error) {
        console.error(`Plan change to "${tier}/${billingInterval}" is not configured:`, error);
        res.status(500).json({
          success: false,
          error: 'That plan is not available right now',
        });
        return;
      }

      const subscription = await stripeService.updateSubscription(subscriptionId, newPriceId);

      // Keep the DB in sync immediately rather than waiting for the
      // customer.subscription.updated webhook -- same pattern as
      // cancelSubscription/resumeSubscription below. asOf: new Date() -- see
      // cancelSubscription's identical comment above.
      await stripeService.updateOrganizationSubscription(organizationId, {
        status: subscription.status,
        tier,
      }, { asOf: new Date() });

      res.status(200).json({
        success: true,
        data: {
          status: subscription.status,
          tier,
          billingInterval,
        },
      });
    } catch (error: any) {
      console.error('Error changing subscription plan:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to change subscription plan',
      });
    }
  }

  /**
   * POST /api/stripe/resume-subscription
   * Resume a subscription that was set to cancel
   */
  async resumeSubscription(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      if (!this.requireBillingAdmin(req, res)) return;

      const organizationId = req.user.organizationId;

      // Get organization subscription
      const orgResult = await pool.query(
        'SELECT stripe_subscription_id FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (orgResult.rows.length === 0 || !orgResult.rows[0].stripe_subscription_id) {
        res.status(400).json({
          success: false,
          error: 'No subscription found',
        });
        return;
      }

      const subscriptionId = orgResult.rows[0].stripe_subscription_id;

      // Resume subscription
      const subscription = await stripeService.resumeSubscription(subscriptionId);

      // Update database. asOf: new Date() -- see cancelSubscription's
      // identical comment above.
      await stripeService.updateOrganizationSubscription(organizationId, {
        status: subscription.status,
        cancelAtPeriodEnd: false,
      }, { asOf: new Date() });

      res.status(200).json({
        success: true,
        data: {
          status: subscription.status,
          cancelAtPeriodEnd: false,
        },
      });
    } catch (error: any) {
      console.error('Error resuming subscription:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to resume subscription',
      });
    }
  }

  /**
   * GET /api/stripe/invoices
   * Get customer invoices
   */
  async getInvoices(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
        return;
      }

      const organizationId = req.user.organizationId;

      // Get organization Stripe customer ID
      const orgResult = await pool.query(
        'SELECT stripe_customer_id FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (orgResult.rows.length === 0 || !orgResult.rows[0].stripe_customer_id) {
        res.status(200).json({
          success: true,
          data: [],
        });
        return;
      }

      const customerId = orgResult.rows[0].stripe_customer_id;

      // Get invoices from Stripe
      let invoices = [];
      try {
        invoices = await stripeService.listInvoices(customerId, 20);
      } catch (stripeError: any) {
        // Customer may not exist in current Stripe environment
        console.warn('Could not fetch invoices from Stripe:', stripeError.message);
        res.status(200).json({ success: true, data: [] });
        return;
      }

      // amount_refunded/refund_status are derived from our own refunds
      // ledger -- the actual source of truth for what this app has
      // refunded -- rather than a Stripe Invoice field. The installed
      // Stripe API version (2025-12-15.clover) has no amount_refunded field
      // on Invoice at all (see node_modules/stripe/types/Invoices.d.ts), so
      // the previous `(invoice as any).amount_refunded` always read
      // undefined and refund_status was always null; this closes that gap
      // now that real refund tracking exists (see the `refunds` table).
      const invoiceIds = invoices.map(invoice => invoice.id).filter((id): id is string => !!id);
      const refundTotalsResult = invoiceIds.length > 0
        ? await pool.query(
            `SELECT stripe_invoice_id, COALESCE(SUM(amount), 0) AS refunded
             FROM refunds
             WHERE organization_id = $1 AND status = 'succeeded' AND stripe_invoice_id = ANY($2)
             GROUP BY stripe_invoice_id`,
            [organizationId, invoiceIds]
          )
        : { rows: [] as Array<{ stripe_invoice_id: string; refunded: string }> };
      const refundedByInvoice = new Map<string, number>(
        refundTotalsResult.rows.map(row => [row.stripe_invoice_id, parseInt(row.refunded, 10)])
      );

      res.status(200).json({
        success: true,
        data: invoices.map(invoice => {
          const amountRefunded = refundedByInvoice.get(invoice.id) ?? 0;
          return {
            id: invoice.id,
            number: invoice.number,
            status: invoice.status,
            amount_paid: invoice.amount_paid,
            currency: invoice.currency,
            created: invoice.created,
            pdfUrl: invoice.invoice_pdf,
            hostedUrl: invoice.hosted_invoice_url,
            amount_refunded: amountRefunded,
            refund_status: amountRefunded <= 0 ? null : (amountRefunded >= invoice.amount_paid ? 'full' : 'partial'),
          };
        }),
      });
    } catch (error: any) {
      console.error('Error getting invoices:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get invoices',
      });
    }
  }

  /**
   * Maps a Stripe Invoice onto the pre-existing frontend `Payment` shape
   * (lib/types.ts). A "Payment" in this app IS a paid invoice -- Payment.id
   * is the Stripe invoice id, which is also what issueRefund below accepts
   * as `paymentId` and independently re-resolves/validates server-side.
   * paymentMethod/paymentMethodType are hardcoded to 'card': every Checkout
   * Session this app creates is `payment_method_types: ['card']` only (see
   * stripeService.createCheckoutSession), so this is factually accurate
   * today, not a guess -- revisit if another payment method type is ever
   * enabled.
   */
  private mapInvoiceToPayment(invoice: Stripe.Invoice): Record<string, unknown> {
    const customer = invoice.customer;
    const customerId = typeof customer === 'string' ? customer : customer?.id;
    const status = (() => {
      switch (invoice.status) {
        case 'paid': return 'succeeded';
        case 'open': return 'pending';
        case 'void': return 'cancelled';
        case 'uncollectible': return 'failed';
        default: return 'pending';
      }
    })();

    return {
      id: invoice.id,
      amount: invoice.amount_paid || invoice.amount_due,
      currency: invoice.currency,
      status,
      paymentMethod: 'card',
      paymentMethodType: 'card',
      invoiceId: invoice.id,
      customerId,
      customerName: invoice.customer_name ?? undefined,
      transactionId: invoice.number || invoice.id,
      description: invoice.description ?? undefined,
      createdAt: new Date(invoice.created * 1000).toISOString(),
      updatedAt: new Date(invoice.created * 1000).toISOString(),
      hostedUrl: invoice.hosted_invoice_url ?? undefined,
      pdfUrl: invoice.invoice_pdf ?? undefined,
    };
  }

  /**
   * Resolve the PaymentIntent id backing a paid invoice, under the
   * installed Stripe API version's InvoicePayment model (invoices no
   * longer carry a direct payment_intent/charge field -- see
   * stripeService.listInvoicePayments). Returns null if the invoice has no
   * paid/default InvoicePayment, or if that payment isn't PaymentIntent-
   * backed (e.g. a legacy charge-only payment) -- callers must treat null
   * as "not refundable through this path" rather than guess.
   */
  private async resolvePaymentIntentIdForInvoice(invoiceId: string): Promise<string | null> {
    const payments = await stripeService.listInvoicePayments(invoiceId);
    const paid = payments.find(p => p.status === 'paid') ?? payments.find(p => p.is_default);
    if (!paid || paid.payment.type !== 'payment_intent' || !paid.payment.payment_intent) {
      return null;
    }
    const pi = paid.payment.payment_intent;
    return typeof pi === 'string' ? pi : pi.id;
  }

  /**
   * Insert-or-update a refund row keyed on Stripe's own refund id -- the
   * single idempotency mechanism shared by issueRefund (direct issuance)
   * and the charge.refunded/refund.updated webhook handlers (redelivery
   * safety). A redelivered webhook, or a webhook arriving after our own
   * issueRefund already inserted the row, can only update `status`/
   * `updated_at` on the existing row -- it can never create a duplicate.
   */
  private async upsertRefundRecord(
    organizationId: string,
    refund: Stripe.Refund,
    extra: { invoiceId?: string | null; chargeId?: string | null; reasonDetail?: string; initiatedBy?: string } = {}
  ): Promise<Record<string, unknown> | null> {
    const paymentIntentId = typeof refund.payment_intent === 'string'
      ? refund.payment_intent
      : refund.payment_intent?.id;

    if (!paymentIntentId) {
      // Every refund this app issues is created against a resolved
      // PaymentIntent (see issueRefund); a refund with none is a legacy
      // charge-only refund this table isn't designed to hold. Log and skip
      // rather than violate the NOT NULL constraint or fabricate a value.
      console.warn(`Refund ${refund.id} has no payment_intent -- skipping persistence`);
      return null;
    }

    const chargeId = extra.chargeId
      ?? (typeof refund.charge === 'string' ? refund.charge : refund.charge?.id)
      ?? null;

    const result = await pool.query(
      `INSERT INTO refunds (
         organization_id, stripe_refund_id, stripe_payment_intent_id, stripe_charge_id,
         stripe_invoice_id, amount, currency, status, reason, reason_detail, initiated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (stripe_refund_id) DO UPDATE SET
         status = EXCLUDED.status,
         updated_at = NOW()
       RETURNING *`,
      [
        organizationId,
        refund.id,
        paymentIntentId,
        chargeId,
        extra.invoiceId ?? null,
        refund.amount,
        refund.currency,
        refund.status ?? 'pending',
        refund.reason ?? null,
        extra.reasonDetail ?? null,
        extra.initiatedBy ?? null,
      ]
    );
    return result.rows[0];
  }

  private mapRefundRow(row: Record<string, any>): Record<string, unknown> {
    return {
      id: row.stripe_refund_id,
      paymentId: row.stripe_invoice_id ?? row.stripe_payment_intent_id,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      reason: row.reason_detail ?? row.reason ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  /**
   * GET /api/payments
   * List this organization's payments, derived from its Stripe invoices
   * (reusing stripeService.listInvoices rather than a second, duplicate
   * Stripe integration). Available to any authenticated org member --
   * read-only payment history, same access level as GET
   * /api/stripe/invoices and /api/stripe/subscription.
   */
  async listPayments(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const organizationId = req.user.organizationId;
      const orgResult = await pool.query(
        'SELECT stripe_customer_id FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (orgResult.rows.length === 0 || !orgResult.rows[0].stripe_customer_id) {
        res.status(200).json({ success: true, data: [] });
        return;
      }
      const customerId = orgResult.rows[0].stripe_customer_id;

      const query = req.query as Record<string, string | undefined>;
      const limitParam = parseInt(query.limit ?? '20', 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 20;
      const pageParam = parseInt(query.page ?? '1', 10);
      const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

      // Stripe's list API is cursor-paginated, not page-numbered -- walk
      // forward page-by-page (bounded) to resolve the requested page. Bounded
      // at 200 scanned invoices: this is an admin-facing history view, not a
      // full historical export, so unbounded deep pagination isn't worth the
      // added Stripe round-trips.
      const MAX_SCAN = 200;
      const need = Math.min(page * limit, MAX_SCAN);
      let invoices: Stripe.Invoice[] = [];
      try {
        let startingAfter: string | undefined;
        while (invoices.length < need) {
          const batchLimit = Math.min(100, need - invoices.length);
          const batch = await stripeService.listInvoices(customerId, batchLimit, startingAfter);
          if (batch.length === 0) break;
          invoices = invoices.concat(batch);
          startingAfter = batch[batch.length - 1].id;
          if (batch.length < batchLimit) break;
        }
      } catch (stripeError: any) {
        console.warn('Could not fetch payments from Stripe:', stripeError.message);
        res.status(200).json({ success: true, data: [] });
        return;
      }

      const pageInvoices = invoices.slice((page - 1) * limit, page * limit);
      let payments = pageInvoices.map(invoice => this.mapInvoiceToPayment(invoice));

      // Overlay refund status from our own ledger -- a fully-refunded
      // invoice is reported as status "refunded" rather than "succeeded".
      const invoiceIds = pageInvoices.map(i => i.id).filter((id): id is string => !!id);
      if (invoiceIds.length > 0) {
        const refundTotals = await pool.query(
          `SELECT stripe_invoice_id, COALESCE(SUM(amount), 0) AS refunded
           FROM refunds
           WHERE organization_id = $1 AND status = 'succeeded' AND stripe_invoice_id = ANY($2)
           GROUP BY stripe_invoice_id`,
          [organizationId, invoiceIds]
        );
        const refundedByInvoice = new Map<string, number>(
          refundTotals.rows.map((r: any) => [r.stripe_invoice_id, parseInt(r.refunded, 10)])
        );
        payments = payments.map(p => {
          const refunded = refundedByInvoice.get(p.id as string) ?? 0;
          if (refunded > 0 && refunded >= (p.amount as number)) {
            return { ...p, status: 'refunded' };
          }
          return p;
        });
      }

      const { status, startDate, endDate, minAmount, maxAmount, search } = query;
      if (status) payments = payments.filter(p => p.status === status);
      if (startDate) {
        const startSec = new Date(startDate).getTime() / 1000;
        payments = payments.filter(p => new Date(p.createdAt as string).getTime() / 1000 >= startSec);
      }
      if (endDate) {
        const endSec = new Date(endDate).getTime() / 1000;
        payments = payments.filter(p => new Date(p.createdAt as string).getTime() / 1000 <= endSec);
      }
      if (minAmount) payments = payments.filter(p => (p.amount as number) >= Number(minAmount));
      if (maxAmount) payments = payments.filter(p => (p.amount as number) <= Number(maxAmount));
      if (search) {
        const needle = search.toLowerCase();
        payments = payments.filter(p =>
          (p.id as string).toLowerCase().includes(needle) ||
          (p.transactionId as string).toLowerCase().includes(needle)
        );
      }

      res.status(200).json({ success: true, data: payments });
    } catch (error: any) {
      console.error('Error listing payments:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to list payments' });
    }
  }

  /**
   * GET /api/payments/stats
   * Aggregate stats over a bounded window of recent invoices (up to 100) --
   * an admin-facing summary, not a full historical ledger scan.
   * refundedAmount is sourced from our own refunds table.
   */
  async getPaymentStats(req: Request, res: Response): Promise<void> {
    const emptyStats = { totalAmount: 0, totalCount: 0, successfulCount: 0, failedCount: 0, refundedAmount: 0 };
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const organizationId = req.user.organizationId;
      const orgResult = await pool.query(
        'SELECT stripe_customer_id FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (orgResult.rows.length === 0 || !orgResult.rows[0].stripe_customer_id) {
        res.status(200).json({ success: true, data: emptyStats });
        return;
      }
      const customerId = orgResult.rows[0].stripe_customer_id;

      let invoices: Stripe.Invoice[] = [];
      try {
        invoices = await stripeService.listInvoices(customerId, 100);
      } catch (stripeError: any) {
        console.warn('Could not fetch payment stats from Stripe:', stripeError.message);
        res.status(200).json({ success: true, data: emptyStats });
        return;
      }

      const payments = invoices.map(invoice => this.mapInvoiceToPayment(invoice));
      const refundedResult = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM refunds WHERE organization_id = $1 AND status = 'succeeded'`,
        [organizationId]
      );

      res.status(200).json({
        success: true,
        data: {
          totalAmount: payments.reduce((sum, p) => sum + (p.amount as number), 0),
          totalCount: payments.length,
          successfulCount: payments.filter(p => p.status === 'succeeded' || p.status === 'refunded').length,
          failedCount: payments.filter(p => p.status === 'failed').length,
          refundedAmount: parseInt(refundedResult.rows[0].total, 10),
        },
      });
    } catch (error: any) {
      console.error('Error getting payment stats:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to get payment stats' });
    }
  }

  /**
   * GET /api/payments/:id
   * `:id` is a Stripe invoice id (see mapInvoiceToPayment). Ownership is
   * verified server-side (invoice.customer must match this organization's
   * stripe_customer_id) before anything is returned -- a mismatch is
   * reported as 404, identical to a truly nonexistent id, so this endpoint
   * never confirms or denies that an invoice exists for a *different*
   * organization.
   */
  async getPayment(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const organizationId = req.user.organizationId;
      const invoiceId = req.params.id;

      const orgResult = await pool.query(
        'SELECT stripe_customer_id FROM organizations WHERE id = $1',
        [organizationId]
      );
      const customerId = orgResult.rows[0]?.stripe_customer_id;
      if (!customerId) {
        res.status(404).json({ success: false, error: 'Payment not found' });
        return;
      }

      let invoice: Stripe.Invoice;
      try {
        invoice = await stripeService.getInvoice(invoiceId);
      } catch {
        res.status(404).json({ success: false, error: 'Payment not found' });
        return;
      }

      const invoiceCustomerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (invoiceCustomerId !== customerId) {
        res.status(404).json({ success: false, error: 'Payment not found' });
        return;
      }

      const payment = this.mapInvoiceToPayment(invoice);

      try {
        const paymentIntentId = await this.resolvePaymentIntentIdForInvoice(invoice.id as string);
        if (paymentIntentId) {
          payment.transactionId = paymentIntentId;
        }
      } catch (err) {
        // Best-effort enrichment only -- an otherwise-valid payment detail
        // lookup shouldn't fail because the transaction-id enrichment did.
        console.warn(`Could not resolve payment intent for invoice ${invoice.id}:`, err);
      }

      const refundResult = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS refunded FROM refunds WHERE organization_id = $1 AND stripe_invoice_id = $2 AND status = 'succeeded'`,
        [organizationId, invoice.id]
      );
      const refundedAmount = parseInt(refundResult.rows[0].refunded, 10);
      if (refundedAmount > 0 && refundedAmount >= (payment.amount as number)) {
        payment.status = 'refunded';
      }

      res.status(200).json({ success: true, data: payment });
    } catch (error: any) {
      console.error('Error getting payment:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to get payment' });
    }
  }

  /**
   * GET /api/refunds
   * List this organization's refunds from our own ledger. Read-only, open
   * to any authenticated org member -- only *issuing* a refund
   * (POST /api/refunds, below) is owner/admin-gated.
   */
  async listRefunds(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const organizationId = req.user.organizationId;
      const query = req.query as Record<string, string | undefined>;
      const conditions: string[] = ['organization_id = $1'];
      const values: unknown[] = [organizationId];

      if (query.status) {
        conditions.push(`status = $${values.length + 1}`);
        values.push(query.status);
      }
      if (query.startDate) {
        conditions.push(`created_at >= $${values.length + 1}`);
        values.push(new Date(query.startDate));
      }
      if (query.endDate) {
        conditions.push(`created_at <= $${values.length + 1}`);
        values.push(new Date(query.endDate));
      }
      if (query.search) {
        conditions.push(`(stripe_refund_id ILIKE $${values.length + 1} OR stripe_payment_intent_id ILIKE $${values.length + 1} OR stripe_invoice_id ILIKE $${values.length + 1})`);
        values.push(`%${query.search}%`);
      }

      const result = await pool.query(
        `SELECT * FROM refunds WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
        values
      );

      res.status(200).json({ success: true, data: result.rows.map(row => this.mapRefundRow(row)) });
    } catch (error: any) {
      console.error('Error listing refunds:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to list refunds' });
    }
  }

  /**
   * GET /api/refunds/stats
   */
  async getRefundStats(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const organizationId = req.user.organizationId;
      const result = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total_amount, COUNT(*) AS total_count
         FROM refunds WHERE organization_id = $1 AND status = 'succeeded'`,
        [organizationId]
      );

      res.status(200).json({
        success: true,
        data: {
          totalAmount: parseInt(result.rows[0].total_amount, 10),
          totalCount: parseInt(result.rows[0].total_count, 10),
        },
      });
    } catch (error: any) {
      console.error('Error getting refund stats:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to get refund stats' });
    }
  }

  /**
   * POST /api/refunds
   * Issue a real Stripe refund (full or partial). Owner/admin only (see
   * requireBillingAdmin) -- members/viewers get 403 and Stripe is never
   * called, same authorization model as cancelSubscription/changePlan/
   * createCustomerPortal above.
   *
   * The client supplies only `paymentId` (our Payment.id, i.e. a Stripe
   * invoice id), an optional `amount` (cents; omitted = full refund of
   * whatever remains refundable), and an optional `reason`. Nothing else is
   * accepted (see ALLOWED_REFUND_FIELDS), and none of these three values is
   * ever forwarded to Stripe without independent server-side resolution:
   * the invoice is fetched by id and its `customer` is checked against this
   * organization's own stripe_customer_id (a client cannot refund another
   * organization's payment by guessing/supplying its invoice id), the
   * PaymentIntent/Charge actually backing that invoice is resolved
   * server-side (never taken from the client), and the requested amount is
   * validated against that charge's real remaining refundable balance
   * before Stripe is ever called.
   */
  async issueRefund(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      if (!this.requireBillingAdmin(req, res)) return;

      const body = (req.body ?? {}) as Record<string, unknown>;
      const disallowedFields = Object.keys(body).filter(key => !ALLOWED_REFUND_FIELDS.has(key));
      if (disallowedFields.length > 0) {
        res.status(400).json({
          success: false,
          error: `Unsupported field(s): ${disallowedFields.join(', ')}. Only "paymentId", "amount", and "reason" are accepted.`,
        });
        return;
      }

      const { paymentId, amount, reason } = body;
      const organizationId = req.user.organizationId;

      if (typeof paymentId !== 'string' || paymentId.length === 0) {
        res.status(400).json({ success: false, error: 'A valid payment id is required' });
        return;
      }

      if (amount !== undefined && (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0)) {
        res.status(400).json({ success: false, error: 'Refund amount must be a positive whole number of cents' });
        return;
      }

      if (reason !== undefined && !isRefundReason(reason)) {
        res.status(400).json({ success: false, error: 'A valid refund reason is required' });
        return;
      }

      const orgResult = await pool.query(
        'SELECT stripe_customer_id FROM organizations WHERE id = $1',
        [organizationId]
      );
      const customerId = orgResult.rows[0]?.stripe_customer_id;
      if (!customerId) {
        res.status(400).json({ success: false, error: 'No Stripe customer found for this organization' });
        return;
      }

      // Resolve + validate the invoice server-side. paymentId is our own
      // Payment.id (a Stripe invoice id), never a client-supplied
      // payment_intent/charge id.
      let invoice: Stripe.Invoice;
      try {
        invoice = await stripeService.getInvoice(paymentId);
      } catch {
        res.status(404).json({ success: false, error: 'Payment not found' });
        return;
      }

      const invoiceCustomerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (invoiceCustomerId !== customerId) {
        // Same "not found" as a genuinely nonexistent id -- this endpoint
        // never confirms whether an invoice id belongs to another org.
        res.status(404).json({ success: false, error: 'Payment not found' });
        return;
      }

      if (invoice.status !== 'paid') {
        res.status(400).json({ success: false, error: 'Only a paid payment can be refunded' });
        return;
      }

      const paymentIntentId = await this.resolvePaymentIntentIdForInvoice(invoice.id as string);
      if (!paymentIntentId) {
        res.status(400).json({ success: false, error: 'Unable to resolve a refundable payment for this invoice' });
        return;
      }

      const paymentIntent = await stripeService.getPaymentIntentWithCharge(paymentIntentId);
      const charge = paymentIntent.latest_charge;
      if (!charge || typeof charge === 'string') {
        res.status(400).json({ success: false, error: 'Unable to resolve a refundable charge for this invoice' });
        return;
      }

      const refundableAmount = charge.amount - charge.amount_refunded;
      if (refundableAmount <= 0) {
        res.status(400).json({ success: false, error: 'This payment has already been fully refunded' });
        return;
      }

      const refundAmount = typeof amount === 'number' ? amount : refundableAmount;
      if (refundAmount > refundableAmount) {
        res.status(400).json({
          success: false,
          error: `Refund amount exceeds the refundable balance (${refundableAmount} ${charge.currency} remaining)`,
        });
        return;
      }

      const clientReason = typeof reason === 'string' && isRefundReason(reason) ? reason : undefined;
      const stripeReason = clientReason ? toStripeRefundReason(clientReason) : undefined;

      const refund = await stripeService.createRefund({
        payment_intent: paymentIntentId,
        amount: refundAmount,
        ...(stripeReason ? { reason: stripeReason } : {}),
        metadata: {
          organizationId,
          invoiceId: invoice.id as string,
          initiatedBy: req.user.userId,
        },
      });

      const row = await this.upsertRefundRecord(organizationId, refund, {
        invoiceId: invoice.id as string,
        chargeId: charge.id,
        reasonDetail: clientReason,
        initiatedBy: req.user.userId,
      });

      res.status(200).json({ success: true, data: row ? this.mapRefundRow(row) : null });
    } catch (error: any) {
      console.error('Error issuing refund:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to issue refund' });
    }
  }

  /**
   * Persist a refund observed via a charge.refunded/refund.updated webhook.
   * Resolves the owning organization from the refund's own
   * metadata.organizationId first (set by issueRefund above for every
   * refund this app creates); falls back to resolving via the underlying
   * charge's Stripe customer for a refund created outside this app (e.g.
   * directly in the Stripe Dashboard). Writes through runWithOrgClient so
   * the INSERT/UPDATE against RLS-protected `refunds` carries the right
   * app.current_organization_id -- same mechanism github-webhook.routes.ts
   * uses for its own unauthenticated, non-JWT webhook path.
   *
   * Wrapped in an explicit Promise rather than a bare `await
   * runWithOrgClient(...)`: runWithOrgClient itself doesn't await the
   * callback it hands to requestContext.run, so awaiting it alone would
   * resolve before the upsert actually completes. This wrapper only
   * resolves once the upsert (or its failure) actually happens.
   */
  private async syncRefundFromWebhook(refund: any, charge: any | null, res: Response): Promise<void> {
    let organizationId: string | undefined = refund?.metadata?.organizationId;

    if (!organizationId) {
      let customerId = charge?.customer;
      if (!customerId && refund?.charge) {
        try {
          const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
          const fetchedCharge = await stripeService.retrieveCharge(chargeId);
          customerId = fetchedCharge.customer;
        } catch (err) {
          console.warn('Could not resolve charge for refund webhook:', err);
        }
      }
      if (customerId) {
        const resolvedCustomerId = typeof customerId === 'string' ? customerId : customerId.id;
        const organization = await stripeService.getOrganizationByCustomerId(resolvedCustomerId);
        organizationId = organization?.id;
      }
    }

    if (!organizationId) {
      console.warn(`Could not resolve organization for refund ${refund?.id} -- skipping persistence`);
      return;
    }

    const resolvedOrgId = organizationId;
    const chargeId = charge?.id ?? (typeof refund.charge === 'string' ? refund.charge : refund.charge?.id);
    const invoiceId = refund?.metadata?.invoiceId;

    await new Promise<void>((resolve, reject) => {
      runWithOrgClient(resolvedOrgId, res, async () => {
        try {
          await this.upsertRefundRecord(resolvedOrgId, refund, { chargeId, invoiceId });
          resolve();
        } catch (err) {
          reject(err);
        }
      }).catch(reject);
    });
  }

  private async handleChargeRefunded(charge: any, res: Response): Promise<void> {
    const refunds: any[] = charge?.refunds?.data ?? [];
    for (const refund of refunds) {
      await this.syncRefundFromWebhook(refund, charge, res);
    }
  }

  private async handleRefundUpdated(refund: any, res: Response): Promise<void> {
    await this.syncRefundFromWebhook(refund, null, res);
  }

  /**
   * POST /api/stripe/webhook
   * Handle Stripe webhooks
   *
   * Signature verification and the HTTP response contract for a genuinely
   * bad/missing signature are completely unchanged from before the
   * idempotency ledger existed. Everything past a *verified* event now goes
   * through claim -> dispatch -> resolve (processWebhookEventWithLedger)
   * instead of going straight into the dispatch switch -- see that method
   * for the full claim/resolve/HTTP-status contract.
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const signature = req.headers['stripe-signature'] as string;
      if (!signature) {
        res.status(400).json({
          success: false,
          error: 'Missing stripe-signature header',
        });
        return;
      }

      // Get raw payload - must be Buffer or string, not parsed object
      let payload: string | Buffer;
      if (Buffer.isBuffer(req.body)) {
        payload = req.body;
      } else if (typeof req.body === 'string') {
        payload = req.body;
      } else {
        console.error('❌ req.body is not Buffer or string, it is:', typeof req.body, req.body?.constructor?.name);
        res.status(400).json({
          success: false,
          error: 'Webhook body must be raw (not parsed JSON)',
        });
        return;
      }

      // Verify webhook signature with raw payload
      const event = stripeService.verifyWebhookSignature(payload, signature);

      if (!event) {
        res.status(400).json({
          success: false,
          error: 'Invalid signature',
        });
        return;
      }

      console.log(`🔔 Webhook received: ${event.type} (${event.id})`);

      await this.processWebhookEventWithLedger(event, res);
    } catch (error) {
      // Reached only for a handler-thrown business error (see
      // processWebhookEventWithLedger, which rethrows after recording the
      // failure in the ledger) or an unexpected error before the ledger was
      // even reached. Response shape/status (400) is unchanged from before
      // the ledger existed -- Stripe retries on any non-2xx.
      console.error('❌ Webhook error:', error instanceof Error ? error.message : error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Webhook processing failed'
      });
    }
  }

  /**
   * Runs the existing per-event-type dispatch switch, unchanged. Never
   * touches the ledger or the HTTP response itself -- that's entirely
   * processWebhookEventWithLedger's job. An event type with no case here
   * falls through to `default:` and returns normally (no throw), which is
   * what lets processWebhookEventWithLedger mark it 'processed' exactly
   * like a handled event -- see that method's comment on unhandled events.
   */
  private async dispatchWebhookEvent(event: Stripe.Event, res: Response): Promise<void> {
    // Computed once here, not inside each handler: the Stripe Event
    // envelope's own `created` is the ordering signal for the two
    // subscription webhook handlers (see StripeService.
    // updateOrganizationSubscription's own comment for why the envelope,
    // not any field on the Subscription payload). checkout.session.completed
    // deliberately does NOT receive this -- it's treated the same as the
    // other synchronous, first-write call sites (asOf: new Date()), not as
    // an ordering-sensitive subscription-lifecycle event.
    const eventCreatedAt = new Date(event.created * 1000);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutSessionCompleted(event.data.object);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object, eventCreatedAt);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object, eventCreatedAt);
        break;

      case 'invoice.paid':
        await this.handleInvoicePaid(event.data.object);
        break;

      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object);
        break;

      case 'charge.refunded':
        await this.handleChargeRefunded(event.data.object, res);
        break;

      case 'refund.updated':
        await this.handleRefundUpdated(event.data.object, res);
        break;

      default:
        // Intentionally not an error: this application has no business
        // logic for this event type. It still needs to reach a terminal
        // ledger state (see caller) so it doesn't read as permanently stuck
        // to an operator, and so Stripe isn't asked to keep retrying it.
        console.log('ℹ️ Unhandled event type:', event.type);
    }
  }

  /**
   * Owns the stripe_webhook_events ledger lifecycle for one verified event:
   * claim -> dispatchWebhookEvent (unchanged business logic) -> resolve.
   * See backend/src/services/stripe-webhook-ledger.service.ts for the claim/
   * resolve mechanics (session-level advisory lock, no time-based reclaim).
   *
   * Deliberately does NOT wrap dispatchWebhookEvent in the same DB
   * transaction as the claim/resolve writes: several handlers make external
   * calls (Stripe reads in checkout.session.completed/refund sync, a Resend
   * email in handleInvoicePaymentFailed), and holding a Postgres transaction
   * open across a network round-trip to a third party would tie up one of
   * this pool's 50 connections for however long that call takes -- a real
   * path to pool exhaustion this codebase doesn't currently risk anywhere
   * else. Claim and resolve are each a single short, separately-committed
   * statement instead; dispatchWebhookEvent runs in between using the
   * existing shared `pool` exactly as it always has (handlers are
   * completely unmodified by this change).
   *
   * Idempotency vs. ordering, explicitly: this ledger only ever compares a
   * stripe_event_id against itself. It cannot and does not attempt to
   * detect that a *different* event id for the same object is stale
   * relative to another -- that is what
   * organizations.latest_processed_invoice_created_at (invoice ordering,
   * via StripeService.recordPaymentFailure/recordPaymentRecovery) and
   * organizations.latest_processed_subscription_event_created_at
   * (subscription ordering, via StripeService.
   * updateOrganizationSubscription) each separately handle, unchanged by
   * this method. Event-ID idempotency and object-level ordering are
   * separate concerns solved by separate, domain-specific mechanisms; this
   * method only ever does the former.
   *
   * HTTP status contract:
   *  - 200: fresh success, intentionally-unhandled event type, exact
   *    duplicate of an already-processed event, or a genuine
   *    concurrent-in-flight duplicate. Stripe stops retrying in all four
   *    cases -- correct, since none of them require another attempt.
   *  - 400: the handler itself threw (existing, unchanged business-error
   *    behavior -- propagates out to handleWebhook's catch).
   *  - 503: this attempt could not be safely claimed or safely marked
   *    resolved for infrastructure reasons (DB unreachable, an
   *    astronomically rare advisory-lock hash collision that can't be
   *    proven safe to skip, or the resolve write itself failing after the
   *    handler already succeeded). Always retryable -- every current
   *    handler's business mutation is independently idempotent (the
   *    invoice high-water mark, the refunds ON CONFLICT upsert, and every
   *    other handler's absolute-value/no-op-if-unchanged writes), so
   *    Stripe re-delivering and this method re-running the handler is safe.
   *    This is database idempotency, not external-side-effect idempotency:
   *    a re-run can still repeat a read-only Stripe API call or (in one
   *    narrow, pre-existing, out-of-scope-for-this-change window) skip the
   *    payment-failed notification email -- see
   *    StripeService.sendPaymentFailedEmail's own comment.
   */
  private async processWebhookEventWithLedger(event: Stripe.Event, res: Response): Promise<void> {
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (connectError) {
      console.error(`❌ Could not acquire a DB connection to process webhook ${event.id}:`, connectError instanceof Error ? connectError.message : connectError);
      res.status(503).json({ success: false, error: 'Temporarily unable to process this event; please retry' });
      return;
    }

    try {
      let claimResult;
      try {
        claimResult = await claimWebhookEvent(client, event.id, event.type);
      } catch (claimError) {
        console.error(`❌ Failed to claim webhook ${event.id}:`, claimError instanceof Error ? claimError.message : claimError);
        res.status(503).json({ success: false, error: 'Temporarily unable to process this event; please retry' });
        return;
      }

      if (claimResult.kind === 'already_processed') {
        console.log(`Webhook ${event.id} already processed -- skipping duplicate delivery`);
        res.json({ success: true, received: true, duplicate: true });
        return;
      }
      if (claimResult.kind === 'in_progress_elsewhere') {
        console.log(`Webhook ${event.id} is currently being processed by another request -- skipping`);
        res.json({ success: true, received: true, duplicate: true });
        return;
      }
      if (claimResult.kind === 'ambiguous_retry') {
        console.warn(`Webhook ${event.id} could not be safely claimed right now -- asking Stripe to retry`);
        res.status(503).json({ success: false, error: 'Temporarily unable to process this event; please retry' });
        return;
      }

      // claimResult.kind === 'claimed' from here on.
      try {
        await this.dispatchWebhookEvent(event, res);
      } catch (handlerError) {
        const message = handlerError instanceof Error ? handlerError.message : 'Unknown handler error';
        try {
          await resolveWebhookEvent(client, event.id, { success: false, errorMessage: message });
        } catch (resolveError) {
          console.error(`❌ Failed to record failure for webhook ${event.id}:`, resolveError instanceof Error ? resolveError.message : resolveError);
        }
        // Rethrow so handleWebhook's existing catch produces the same 400
        // business-error response it always has.
        throw handlerError;
      }

      try {
        await resolveWebhookEvent(client, event.id, { success: true });
      } catch (resolveError) {
        // The business mutation already committed. Deliberately do NOT
        // return 200 here: doing so would tell Stripe this event is fully
        // handled, so nothing would ever come back to durably record that
        // -- the row would stay 'processing' forever even though its
        // advisory lock has already been released. A 503 lets Stripe
        // redeliver; re-running the (already-succeeded) handler is safe for
        // the same idempotency reasons documented on this method.
        console.error(`❌ Webhook ${event.id} processed successfully but ledger resolve failed:`, resolveError instanceof Error ? resolveError.message : resolveError);
        res.status(503).json({ success: false, error: 'Processed but failed to record completion; please retry' });
        return;
      }

      console.log(`✅ Webhook ${event.id} processed successfully`);
      res.json({ success: true, received: true });
    } finally {
      client.release();
    }
  }
  // Webhook event handlers
  private async handleCheckoutSessionCompleted(session: any): Promise<void> {
    try {
      const organizationId = session.metadata?.organizationId;
      if (!organizationId) {
        console.warn('⚠️ No organizationId in session metadata');
        return;
      }

      console.log(`💳 Checkout completed for organization ${organizationId}`);

      const customerId = session.customer;
      const subscriptionId = session.subscription;

      console.log(`👤 Customer ID: ${customerId}`);
      console.log(`📋 Subscription ID: ${subscriptionId}`);

      if (!subscriptionId) {
        console.warn('⚠️ No subscription ID in checkout session');
        return;
      }

      // Get full subscription details to extract price ID and tier
      const subscription = await stripeService.getSubscription(subscriptionId);
      const priceId = subscription.items.data[0]?.price.id;
      const tier = stripeService.getTierFromPriceId(priceId);

      console.log(`💰 Price ID: ${priceId}`);
      console.log(`🎯 Detected tier: ${tier}`);

      // Update organization with subscription details. asOf: new Date() --
      // treated as a synchronous, first-write establishment of this org's
      // subscription state (same as cancelSubscription/changePlan/
      // resumeSubscription below), not threaded from the enclosing
      // checkout.session.completed event -- see StripeService.
      // updateOrganizationSubscription's comment.
      await stripeService.updateOrganizationSubscription(organizationId, {
        subscriptionId: subscriptionId,
        status: subscription.status,
        tier,
        currentPeriodStart: (subscription as any).current_period_start ? new Date((subscription as any).current_period_start * 1000) : undefined,
        currentPeriodEnd: (subscription as any).current_period_end ? new Date((subscription as any).current_period_end * 1000) : undefined,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      }, { asOf: new Date() });

      console.log(`✅ Organization ${organizationId} updated to ${tier} tier`);
    } catch (error) {
      console.error('❌ Error handling checkout session completed:', error);
      throw error;
    }
  }

  private async handleSubscriptionUpdated(subscription: any, eventCreatedAt: Date): Promise<void> {
    try {
      const customerId = subscription.customer;
      console.log(`👤 Looking up organization for customer ${customerId}`);

      const organization = await stripeService.getOrganizationByCustomerId(customerId);

      if (!organization) {
        console.error(`❌ Organization not found for customer ${customerId}`);
        return;
      }

      console.log(`🏢 Found organization: ${organization.id} (${organization.name})`);

      // Get tier from price ID -- EXCEPT when the subscription itself has
      // reached a terminal state. Stripe fires customer.subscription.updated
      // for the status transition to 'canceled' (in addition to, and not
      // necessarily after, customer.subscription.deleted for the same
      // cancellation -- Stripe does not guarantee relative ordering between
      // them), and 'incomplete_expired' subscriptions never had a
      // successful payment to begin with. In both cases `items` still
      // references the old/never-paid price, so resolving tier from price
      // alone would resurrect paid entitlement -- overriding a synchronous
      // cancellation (StripeController.cancelSubscription) or
      // handleSubscriptionDeleted that already correctly downgraded this
      // organization to 'free'. This intentionally does NOT include
      // 'past_due'/'unpaid': those retain their paid tier by design during
      // the payment-failure grace period (see subscription.middleware.ts's
      // isOrgRestricted) -- access is restricted there via
      // billing_lifecycle_state, never by rewriting subscription_tier.
      //
      // This status-content check catches a stale event whose OWN payload
      // says canceled/incomplete_expired, but it cannot catch a stale event
      // whose payload still says active/past_due/etc. from before a
      // cancellation that has since happened elsewhere (the P1 this
      // eventCreatedAt ordering guard closes, below) -- content and
      // staleness are orthogonal checks, both needed.
      const priceId = subscription.items.data[0]?.price.id;
      const isTerminated = subscription.status === 'canceled' || subscription.status === 'incomplete_expired';
      const tier = isTerminated ? 'free' : stripeService.getTierFromPriceId(priceId);

      console.log(`💰 Price ID: ${priceId}`);
      console.log(`🎯 Detected tier: ${tier}`);
      console.log(`📊 Subscription status: ${subscription.status}`);

      // asOf: eventCreatedAt, strict (no allowTie) -- a stale delivery of
      // this same event redelivered later can never re-win a tie against
      // whatever it (or something newer) already set. See
      // StripeService.updateOrganizationSubscription's comment for the full
      // ordering contract.
      const { applied } = await stripeService.updateOrganizationSubscription(organization.id, {
        subscriptionId: subscription.id,
        status: subscription.status,
        tier,
        currentPeriodStart: (subscription as any).current_period_start ? new Date((subscription as any).current_period_start * 1000) : undefined,
        currentPeriodEnd: (subscription as any).current_period_end ? new Date((subscription as any).current_period_end * 1000) : undefined,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      }, { asOf: eventCreatedAt });

      if (!applied) {
        console.log(`ℹ️ Stale customer.subscription.updated for organization ${organization.id} (event ${eventCreatedAt.toISOString()}) -- ignored, a newer subscription event already applied`);
        return;
      }

      console.log(`✅ Updated subscription for organization ${organization.id} to ${tier} tier`);
    } catch (error) {
      console.error('❌ Error handling subscription update:', error);
      throw error;
    }
  }

  private async handleSubscriptionDeleted(subscription: any, eventCreatedAt: Date): Promise<void> {
    const customerId = subscription.customer;
    const organization = await stripeService.getOrganizationByCustomerId(customerId);

    if (!organization) {
      console.error(`Organization not found for customer ${customerId}`);
      return;
    }

    // Downgrade to free tier. asOf: eventCreatedAt, allowTie: true --
    // deletion is authoritative/terminal and wins an equal-timestamp tie
    // against a customer.subscription.updated fired from the same
    // cancellation (Stripe Event.created has one-second resolution, so
    // this is the expected common case, not a rare edge case -- see
    // StripeService.updateOrganizationSubscription's comment). A truly
    // stale .deleted (older than an event already applied -- e.g. this
    // organization has since resubscribed) is still correctly rejected.
    const { applied } = await stripeService.updateOrganizationSubscription(organization.id, {
      subscriptionId: undefined,
      status: 'canceled',
      tier: 'free',
      cancelAtPeriodEnd: false,
    }, { asOf: eventCreatedAt, allowTie: true });

    if (!applied) {
      console.log(`ℹ️ Stale customer.subscription.deleted for organization ${organization.id} (event ${eventCreatedAt.toISOString()}) -- ignored, a newer subscription event already applied`);
      return;
    }

    // Cancellation is authoritative over any in-flight payment-failure
    // episode: a canceled/deleted subscription has no grace period to
    // enforce (there's nothing paid left to restrict), and leaving a stale
    // grace_period/restricted state around would only confuse a future
    // resubscribe. recordPaymentRecovery is a no-op if the org was already
    // 'healthy'. Gated behind `applied` -- if this deletion was itself
    // stale (rejected above), a newer subscription's own state (e.g. an
    // active resubscription's payment-failure episode) must not be
    // touched by it.
    await stripeService.recordPaymentRecovery(organization.id);

    console.log(`Subscription deleted for organization ${organization.id}, downgraded to free`);
  }

  /**
   * Extracts a usable Invoice.created (Unix seconds -> Date) from a webhook
   * payload, or null if it's missing/malformed. Stripe's own type defines
   * this field as always present and non-null, but webhook payloads are
   * untrusted input from the network -- this is the same defensive posture
   * already applied to invoice.customer below, not a new pattern.
   */
  private extractInvoiceCreatedAt(invoice: any): Date | null {
    return typeof invoice?.created === 'number' ? new Date(invoice.created * 1000) : null;
  }

  /**
   * invoice.paid -- the recovery half of the payment-failure lifecycle (see
   * handleInvoicePaymentFailed below for the failure half). Deliberately
   * touches ONLY billing_lifecycle_state/payment_failed_at/
   * grace_period_ends_at/latest_processed_invoice_created_at -- never
   * subscription_tier/subscription_status, which remain exclusively owned
   * by handleSubscriptionUpdated/handleCheckoutSessionCompleted/
   * handleSubscriptionDeleted above, so this handler can't regress
   * entitlement-sync behavior. Runs on every paid invoice (not just ones
   * that follow a failure) -- recordPaymentRecovery is a no-op when the org
   * was already 'healthy', which is the common case.
   *
   * Passes this invoice's own created time through to recordPaymentRecovery
   * so a stale, out-of-order invoice.paid for an invoice OLDER than one
   * already processed (Stripe does not guarantee webhook delivery order)
   * can never clear a genuinely current, still-unresolved failure -- see
   * that method's comment for the full mechanism.
   */
  private async handleInvoicePaid(invoice: any): Promise<void> {
    const customerId = invoice.customer;
    if (!customerId) {
      console.warn(`invoice.paid ${invoice.id} has no customer -- skipping`);
      return;
    }

    const invoiceCreatedAt = this.extractInvoiceCreatedAt(invoice);
    if (!invoiceCreatedAt) {
      console.warn(`invoice.paid ${invoice.id} has no usable created timestamp -- skipping`);
      return;
    }

    const organization = await stripeService.getOrganizationByCustomerId(
      typeof customerId === 'string' ? customerId : customerId.id
    );
    if (!organization) {
      // Diagnostic context only -- never mutates any organization when the
      // invoice can't be safely mapped to one.
      console.warn(`invoice.paid ${invoice.id}: no organization found for customer ${customerId}`);
      return;
    }

    const { wasRecovery, wasStale } = await stripeService.recordPaymentRecovery(organization.id, invoiceCreatedAt);
    if (wasStale) {
      console.log(`invoice.paid ${invoice.id} for organization ${organization.id} predates a payment event already processed -- ignoring (out-of-order delivery)`);
      return;
    }
    if (wasRecovery) {
      console.log(`Payment recovered for organization ${organization.id} (invoice ${invoice.id}) -- grace period cleared`);
    }
  }

  /**
   * invoice.payment_failed -- the failure half of the payment-failure
   * lifecycle. Resolves the organization from Stripe's own invoice.customer
   * (never a client-supplied id), records the failure idempotently and
   * order-safely (see StripeService.recordPaymentFailure for why repeated/
   * duplicate/out-of-order delivery can't extend the grace deadline or
   * reopen a resolved episode), and sends exactly one notification per
   * failure episode. Deliberately does not touch subscription_tier or
   * subscription_status -- the organization keeps its paid tier during
   * grace; enforcement is handled separately by subscription.middleware.ts
   * reading billing_lifecycle_state/grace_period_ends_at.
   */
  private async handleInvoicePaymentFailed(invoice: any): Promise<void> {
    const customerId = invoice.customer;
    if (!customerId) {
      console.warn(`invoice.payment_failed ${invoice.id} has no customer -- skipping`);
      return;
    }

    const invoiceCreatedAt = this.extractInvoiceCreatedAt(invoice);
    if (!invoiceCreatedAt) {
      console.warn(`invoice.payment_failed ${invoice.id} has no usable created timestamp -- skipping`);
      return;
    }

    const organization = await stripeService.getOrganizationByCustomerId(
      typeof customerId === 'string' ? customerId : customerId.id
    );
    if (!organization) {
      console.warn(`invoice.payment_failed ${invoice.id}: no organization found for customer ${customerId} -- not mutating any organization`);
      return;
    }

    const { wasNewFailure, wasStale, row } = await stripeService.recordPaymentFailure(organization.id, invoiceCreatedAt);
    if (wasStale) {
      console.log(`invoice.payment_failed ${invoice.id} for organization ${organization.id} predates a payment event already processed -- ignoring (out-of-order delivery)`);
      return;
    }
    if (!wasNewFailure || !row.gracePeriodEndsAt) {
      // Already in an unresolved failure episode (or, defensively, a race
      // that left no deadline) -- the deadline and the one-time
      // notification were already handled by the first failure.
      console.log(`Payment failure already recorded for organization ${organization.id} (invoice ${invoice.id}) -- no change`);
      return;
    }

    console.log(`Payment failed for organization ${organization.id} (invoice ${invoice.id}) -- grace period ends ${row.gracePeriodEndsAt.toISOString()}`);
    await stripeService.sendPaymentFailedEmail(organization.id, row.gracePeriodEndsAt);
  }
}

export const stripeController = new StripeController();
