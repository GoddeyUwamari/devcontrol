/**
 * Stripe Controller
 * Handles Stripe payment and subscription HTTP requests
 */

import { Request, Response } from 'express';
import Stripe from 'stripe';
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
        'SELECT stripe_subscription_id FROM organizations WHERE id = $1',
        [organizationId]
      );

      if (orgResult.rows.length === 0 || !orgResult.rows[0].stripe_subscription_id) {
        res.status(400).json({
          success: false,
          error: 'No active subscription found',
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

      // Update database
      await stripeService.updateOrganizationSubscription(organizationId, {
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      });

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
      // cancelSubscription/resumeSubscription below.
      await stripeService.updateOrganizationSubscription(organizationId, {
        status: subscription.status,
        tier,
      });

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

      // Update database
      await stripeService.updateOrganizationSubscription(organizationId, {
        status: subscription.status,
        cancelAtPeriodEnd: false,
      });

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
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      console.log('🔍 DEBUG: req.body type:', typeof req.body);
      console.log('🔍 DEBUG: req.body is Buffer?', Buffer.isBuffer(req.body));
      console.log('🔍 DEBUG: req.body constructor:', req.body?.constructor?.name);

      const signature = req.headers['stripe-signature'] as string;
      if (!signature) {
        res.status(400).json({
          success: false,
          error: 'Missing stripe-signature header',
        });
        return;
      }

      // ✅ Get raw payload - must be Buffer or string, not parsed object
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

      console.log('🔔 Webhook received:', event.type);
      console.log('📦 Event ID:', event.id);
      console.log('🔍 Event data:', JSON.stringify(event.data.object, null, 2));

      // Handle different event types
      switch (event.type) {
        case 'checkout.session.completed':
          console.log('💳 Processing checkout.session.completed');
          await this.handleCheckoutSessionCompleted(event.data.object);
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          console.log('📋 Processing subscription event:', event.type);
          await this.handleSubscriptionUpdated(event.data.object);
          break;

        case 'customer.subscription.deleted':
          console.log('🗑️ Processing subscription deletion');
          await this.handleSubscriptionDeleted(event.data.object);
          break;

        case 'invoice.paid':
          console.log('✅ Processing paid invoice');
          await this.handleInvoicePaid(event.data.object);
          break;

        case 'invoice.payment_failed':
          console.log('❌ Processing failed payment');
          await this.handleInvoicePaymentFailed(event.data.object);
          break;

        case 'charge.refunded':
          console.log('💰 Processing charge.refunded');
          await this.handleChargeRefunded(event.data.object, res);
          break;

        case 'refund.updated':
          console.log('🔄 Processing refund.updated');
          await this.handleRefundUpdated(event.data.object, res);
          break;

        default:
          console.log('ℹ️ Unhandled event type:', event.type);
      }

      console.log('✅ Webhook processed successfully');
      res.json({ success: true, received: true });
    } catch (error) {
      console.error('❌ Webhook error:', error);
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Webhook processing failed'
      });
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

      // Update organization with subscription details
      await stripeService.updateOrganizationSubscription(organizationId, {
        subscriptionId: subscriptionId,
        status: subscription.status,
        tier,
        currentPeriodStart: (subscription as any).current_period_start ? new Date((subscription as any).current_period_start * 1000) : undefined,
        currentPeriodEnd: (subscription as any).current_period_end ? new Date((subscription as any).current_period_end * 1000) : undefined,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      });

      console.log(`✅ Organization ${organizationId} updated to ${tier} tier`);
    } catch (error) {
      console.error('❌ Error handling checkout session completed:', error);
      throw error;
    }
  }

  private async handleSubscriptionUpdated(subscription: any): Promise<void> {
    try {
      const customerId = subscription.customer;
      console.log(`👤 Looking up organization for customer ${customerId}`);

      const organization = await stripeService.getOrganizationByCustomerId(customerId);

      if (!organization) {
        console.error(`❌ Organization not found for customer ${customerId}`);
        return;
      }

      console.log(`🏢 Found organization: ${organization.id} (${organization.name})`);

      // Get tier from price ID
      const priceId = subscription.items.data[0]?.price.id;
      const tier = stripeService.getTierFromPriceId(priceId);

      console.log(`💰 Price ID: ${priceId}`);
      console.log(`🎯 Detected tier: ${tier}`);
      console.log(`📊 Subscription status: ${subscription.status}`);

      // Update organization
      await stripeService.updateOrganizationSubscription(organization.id, {
        subscriptionId: subscription.id,
        status: subscription.status,
        tier,
        currentPeriodStart: (subscription as any).current_period_start ? new Date((subscription as any).current_period_start * 1000) : undefined,
        currentPeriodEnd: (subscription as any).current_period_end ? new Date((subscription as any).current_period_end * 1000) : undefined,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      });

      console.log(`✅ Updated subscription for organization ${organization.id} to ${tier} tier`);
    } catch (error) {
      console.error('❌ Error handling subscription update:', error);
      throw error;
    }
  }

  private async handleSubscriptionDeleted(subscription: any): Promise<void> {
    const customerId = subscription.customer;
    const organization = await stripeService.getOrganizationByCustomerId(customerId);

    if (!organization) {
      console.error(`Organization not found for customer ${customerId}`);
      return;
    }

    // Downgrade to free tier
    await stripeService.updateOrganizationSubscription(organization.id, {
      subscriptionId: undefined,
      status: 'canceled',
      tier: 'free',
      cancelAtPeriodEnd: false,
    });

    // Cancellation is authoritative over any in-flight payment-failure
    // episode: a canceled/deleted subscription has no grace period to
    // enforce (there's nothing paid left to restrict), and leaving a stale
    // grace_period/restricted state around would only confuse a future
    // resubscribe. recordPaymentRecovery is a no-op if the org was already
    // 'healthy'.
    await stripeService.recordPaymentRecovery(organization.id);

    console.log(`Subscription deleted for organization ${organization.id}, downgraded to free`);
  }

  /**
   * invoice.paid -- the recovery half of the payment-failure lifecycle (see
   * handleInvoicePaymentFailed below for the failure half). Deliberately
   * touches ONLY billing_lifecycle_state/payment_failed_at/
   * grace_period_ends_at -- never subscription_tier/subscription_status,
   * which remain exclusively owned by handleSubscriptionUpdated/
   * handleCheckoutSessionCompleted/handleSubscriptionDeleted above, so this
   * handler can't regress entitlement-sync behavior. Runs on every paid
   * invoice (not just ones that follow a failure) -- recordPaymentRecovery
   * is a no-op when the org was already 'healthy', which is the common case.
   */
  private async handleInvoicePaid(invoice: any): Promise<void> {
    const customerId = invoice.customer;
    if (!customerId) {
      console.warn(`invoice.paid ${invoice.id} has no customer -- skipping`);
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

    const { wasRecovery } = await stripeService.recordPaymentRecovery(organization.id);
    if (wasRecovery) {
      console.log(`Payment recovered for organization ${organization.id} (invoice ${invoice.id}) -- grace period cleared`);
    }
  }

  /**
   * invoice.payment_failed -- the failure half of the payment-failure
   * lifecycle. Resolves the organization from Stripe's own invoice.customer
   * (never a client-supplied id), records the failure idempotently (see
   * StripeService.recordPaymentFailure for why repeated/duplicate delivery
   * can't extend the grace deadline), and sends exactly one notification
   * per failure episode. Deliberately does not touch subscription_tier or
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

    const organization = await stripeService.getOrganizationByCustomerId(
      typeof customerId === 'string' ? customerId : customerId.id
    );
    if (!organization) {
      console.warn(`invoice.payment_failed ${invoice.id}: no organization found for customer ${customerId} -- not mutating any organization`);
      return;
    }

    const { wasNewFailure, row } = await stripeService.recordPaymentFailure(organization.id);
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
