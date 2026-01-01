/**
 * Frontend Stripe Service
 * Handles communication with backend Stripe API
 */

import {
  CheckoutSessionResponse,
  SubscriptionResponse,
  InvoicesResponse,
  CustomerPortalResponse,
  CancelSubscriptionResponse,
  SubscriptionTier,
} from '@/types/billing';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

/**
 * Get auth token from localStorage
 */
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

/**
 * Create a Stripe Checkout session and redirect to checkout
 */
export async function createCheckoutSession(
  tier: SubscriptionTier,
  priceId: string
): Promise<CheckoutSessionResponse> {
  try {
    const token = getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${API_BASE_URL}/api/stripe/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        priceId,
        successUrl: `${window.location.origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${window.location.origin}/billing/cancel`,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to create checkout session');
    }

    return data;
  } catch (error: any) {
    console.error('Error creating checkout session:', error);
    return {
      success: false,
      error: error.message || 'Failed to create checkout session',
    };
  }
}

/**
 * Get current subscription details
 */
export async function getSubscription(): Promise<SubscriptionResponse> {
  try {
    const token = getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${API_BASE_URL}/api/stripe/subscription`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get subscription');
    }

    return data;
  } catch (error: any) {
    console.error('Error getting subscription:', error);
    return {
      success: false,
      error: error.message || 'Failed to get subscription',
    };
  }
}

/**
 * Get customer invoices
 */
export async function getInvoices(): Promise<InvoicesResponse> {
  try {
    const token = getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${API_BASE_URL}/api/stripe/invoices`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get invoices');
    }

    return data;
  } catch (error: any) {
    console.error('Error getting invoices:', error);
    return {
      success: false,
      error: error.message || 'Failed to get invoices',
    };
  }
}

/**
 * Open Stripe Customer Portal
 */
export async function openCustomerPortal(): Promise<CustomerPortalResponse> {
  try {
    const token = getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${API_BASE_URL}/api/stripe/customer-portal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        returnUrl: `${window.location.origin}/settings/billing`,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to open customer portal');
    }

    return data;
  } catch (error: any) {
    console.error('Error opening customer portal:', error);
    return {
      success: false,
      error: error.message || 'Failed to open customer portal',
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
    const token = getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${API_BASE_URL}/api/stripe/cancel-subscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ immediate }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to cancel subscription');
    }

    return data;
  } catch (error: any) {
    console.error('Error canceling subscription:', error);
    return {
      success: false,
      error: error.message || 'Failed to cancel subscription',
    };
  }
}

/**
 * Resume a cancelled subscription
 */
export async function resumeSubscription(): Promise<SubscriptionResponse> {
  try {
    const token = getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${API_BASE_URL}/api/stripe/resume-subscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to resume subscription');
    }

    return data;
  } catch (error: any) {
    console.error('Error resuming subscription:', error);
    return {
      success: false,
      error: error.message || 'Failed to resume subscription',
    };
  }
}
