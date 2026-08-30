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
  SubscriptionTier,
} from '@/types/billing';

/**
 * Create a Stripe Checkout session and redirect to checkout
 *
 * The backend resolves the Stripe Price ID and the success/cancel redirect
 * URLs itself -- only the tier name is sent, and the server rejects
 * anything outside starter/pro/enterprise.
 */
export async function createCheckoutSession(
  tier: SubscriptionTier
): Promise<CheckoutSessionResponse> {
  try {
    const response = await api.post<CheckoutSessionResponse>(
      '/api/stripe/create-checkout-session',
      { tier }
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