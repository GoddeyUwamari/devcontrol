/**
 * Stripe Controller
 * Handles Stripe payment and subscription HTTP requests
 */

import { Request, Response } from 'express';
import stripeService from '../services/stripe.service';
import { pool } from '../config/database';

export class StripeController {
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

      const { priceId, successUrl, cancelUrl } = req.body;
      const organizationId = req.user.organizationId;

      if (!priceId) {
        res.status(400).json({
          success: false,
          error: 'Price ID is required',
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

      // Create checkout session
      const session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        organizationId,
        successUrl || `${process.env.FRONTEND_URL}/billing/success`,
        cancelUrl || `${process.env.FRONTEND_URL}/billing`
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
          subscription_cancel_at_period_end
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

      // If no subscription, return free tier
      if (!organization.stripe_subscription_id) {
        res.status(200).json({
          success: true,
          data: {
            tier: 'free',
            status: 'active',
            cancelAtPeriodEnd: false,
          },
        });
        return;
      }

      // Get full subscription details from Stripe
      const subscription = await stripeService.getSubscription(
        organization.stripe_subscription_id
      );

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
      const invoices = await stripeService.listInvoices(customerId, 20);

      res.status(200).json({
        success: true,
        data: invoices.map(invoice => ({
          id: invoice.id,
          number: invoice.number,
          status: invoice.status,
          total: invoice.total,
          currency: invoice.currency,
          created: invoice.created,
          pdfUrl: invoice.invoice_pdf,
          hostedUrl: invoice.hosted_invoice_url,
        })),
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
   * POST /api/stripe/webhook
   * Handle Stripe webhooks
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

      // Verify webhook signature
      const event = stripeService.verifyWebhookSignature(req.body, signature);

      if (!event) {
        res.status(400).json({
          success: false,
          error: 'Invalid signature',
        });
        return;
      }

      console.log(`Received webhook: ${event.type}`);

      // Handle different event types
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event.data.object);
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;

        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSucceeded(event.data.object);
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object);
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      res.status(200).json({ received: true });
    } catch (error: any) {
      console.error('Error handling webhook:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Webhook handler failed',
      });
    }
  }

  // Webhook event handlers
  private async handleCheckoutSessionCompleted(session: any): Promise<void> {
    const organizationId = session.metadata?.organizationId;
    if (!organizationId) return;

    console.log(`Checkout completed for organization ${organizationId}`);

    // Subscription will be handled by subscription.created event
  }

  private async handleSubscriptionUpdated(subscription: any): Promise<void> {
    const customerId = subscription.customer;
    const organization = await stripeService.getOrganizationByCustomerId(customerId);

    if (!organization) {
      console.error(`Organization not found for customer ${customerId}`);
      return;
    }

    // Get tier from price ID
    const priceId = subscription.items.data[0]?.price.id;
    const tier = stripeService.getTierFromPriceId(priceId);

    // Update organization
    await stripeService.updateOrganizationSubscription(organization.id, {
      subscriptionId: subscription.id,
      status: subscription.status,
      tier,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });

    console.log(`Updated subscription for organization ${organization.id} to ${tier}`);
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

    console.log(`Subscription deleted for organization ${organization.id}, downgraded to free`);
  }

  private async handleInvoicePaymentSucceeded(invoice: any): Promise<void> {
    console.log(`Payment succeeded for invoice ${invoice.id}`);
    // Could send receipt email, update credits, etc.
  }

  private async handleInvoicePaymentFailed(invoice: any): Promise<void> {
    console.log(`Payment failed for invoice ${invoice.id}`);
    // Could send notification email, mark account as past_due, etc.
  }
}

export const stripeController = new StripeController();
