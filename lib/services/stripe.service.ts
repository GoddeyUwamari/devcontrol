/**
 * Frontend Stripe Service
 * Handles communication with backend Stripe API
 * Uses authenticated API client for automatic JWT token handling
 */

import { api } from '@/lib/api';
import {
  CheckoutSessionResponse,
  SubscriptionResponse,
  InvoicesResponse,
  CustomerPortalResponse,
  CancelSubscriptionResponse,
  ChangePlanResponse,
  SubscriptionTier,
  BillingInterval,
} from '@/types/billing';

/**
 * Create a Stripe Checkout session and redirect to checkout
 *
 * The backend resolves the Stripe Price ID and the success/cancel redirect
 * URLs itself -- only the tier name and billing interval are sent, and the
 * server rejects anything outside starter/pro/enterprise and
 * monthly/annual (including any attempt to smuggle a priceId or other
 * Stripe object id in the request body).
 */
export async function createCheckoutSession(
  tier: SubscriptionTier,
  billingInterval: BillingInterval
): Promise<CheckoutSessionResponse> {
  try {
    const response = await api.post<CheckoutSessionResponse>(
      '/api/stripe/create-checkout-session',
      { tier, billingInterval }
    );

    return response.data;
  } catch (error: any) {
    console.error('Error creating checkout session:', error);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Failed to create checkout session',
    };
  }
}

/**
 * Get current subscription details
 */
export async function getSubscription(): Promise<SubscriptionResponse> {
  try {
    const response = await api.get<SubscriptionResponse>('/api/stripe/subscription');
    return response.data;
  } catch (error: any) {
    console.error('Error getting subscription:', error);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Failed to get subscription',
    };
  }
}

/**
 * Get customer invoices
 */
export async function getInvoices(): Promise<InvoicesResponse> {
  try {
    const response = await api.get<InvoicesResponse>('/api/stripe/invoices');
    return response.data;
  } catch (error: any) {
    console.error('Error getting invoices:', error);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Failed to get invoices',
    };
  }
}

/**
 * Open Stripe Customer Portal
 */
export async function openCustomerPortal(): Promise<CustomerPortalResponse> {
  try {
    const response = await api.post<CustomerPortalResponse>(
      '/api/stripe/customer-portal',
      {
        returnUrl: `${window.location.origin}/settings/billing`,
      }
    );

    return response.data;
  } catch (error: any) {
    console.error('Error opening customer portal:', error);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Failed to open customer portal',
    };
  }
}

/**
 * Cancel subscription
 */
export async function cancelSubscription(
  immediate: boolean = false
): Promise<CancelSubscriptionResponse> {
  try {
    const response = await api.post<CancelSubscriptionResponse>(
      '/api/stripe/cancel-subscription',
      { immediate }
    );

    return response.data;
  } catch (error: any) {
    console.error('Error canceling subscription:', error);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Failed to cancel subscription',
    };
  }
}

/**
 * Resume a cancelled subscription
 */
export async function resumeSubscription(): Promise<SubscriptionResponse> {
  try {
    const response = await api.post<SubscriptionResponse>(
      '/api/stripe/resume-subscription',
      {}
    );

    return response.data;
  } catch (error: any) {
    console.error('Error resuming subscription:', error);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Failed to resume subscription',
    };
  }
}

/**
 * Upgrade or downgrade the current subscription's tier and/or billing
 * interval. Same as createCheckoutSession: the backend resolves the
 * target Stripe Price ID itself -- only tier and billingInterval are sent.
 */
export async function changePlan(
  tier: SubscriptionTier,
  billingInterval: BillingInterval
): Promise<ChangePlanResponse> {
  try {
    const response = await api.post<ChangePlanResponse>(
      '/api/stripe/change-plan',
      { tier, billingInterval }
    );

    return response.data;
  } catch (error: any) {
    console.error('Error changing subscription plan:', error);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Failed to change subscription plan',
    };
  }
}