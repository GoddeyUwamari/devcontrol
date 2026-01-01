import Stripe from 'stripe';
import { pool } from '../config/database';

// Initialize Stripe with API version
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
});

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
      const customer = await stripe.customers.create({
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
      const session = await stripe.checkout.sessions.create({
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
      const subscription = await stripe.subscriptions.create({
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
      const subscription = await stripe.subscriptions.cancel(subscriptionId);

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
      const subscription = await stripe.subscriptions.update(subscriptionId, {
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
      const subscription = await stripe.subscriptions.update(subscriptionId, {
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
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);

      // Update the subscription item with new price
      const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
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
      const invoice = await (stripe.invoices as any).retrieveUpcoming({
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
      const invoices = await stripe.invoices.list({
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
      const session = await stripe.billingPortal.sessions.create({
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
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
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
      const customer = await stripe.customers.retrieve(customerId);
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

      const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
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
        updates.push(`subscription_tier = $${paramIndex++}`);
        values.push(data.tier);
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
        return;
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(organizationId);

      const query = `
        UPDATE organizations
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
      `;

      await pool.query(query, values);
      console.log(`Updated organization ${organizationId} subscription info`);
    } catch (error) {
      console.error('Error updating organization subscription:', error);
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
   * Get tier name from Stripe price ID
   */
  getTierFromPriceId(priceId: string): string {
    const STARTER_PRICE_ID = process.env.STRIPE_PRICE_STARTER || 'price_1Skm0uH8pNFfrvRPuccIDLoA';
    const PRO_PRICE_ID = process.env.STRIPE_PRICE_PRO || 'price_1Skm2eH8pNFfrvRPLh2mgf6l';
    const ENTERPRISE_PRICE_ID = process.env.STRIPE_PRICE_ENTERPRISE || 'price_1Skm4iH8pNFfrvRPa6nDnjqc';

    if (priceId === STARTER_PRICE_ID) return 'starter';
    if (priceId === PRO_PRICE_ID) return 'pro';
    if (priceId === ENTERPRISE_PRICE_ID) return 'enterprise';

    return 'free';
  }
}

export default new StripeService();
