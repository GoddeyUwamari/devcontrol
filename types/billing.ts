/**
 * Billing and Stripe-related TypeScript types
 */

export type SubscriptionTier = 'free' | 'starter' | 'pro' | 'enterprise';

export type SubscriptionStatus =
  | 'free'
  | 'active'
  | 'trialing'
  | 'canceled'
  | 'past_due'
  | 'unpaid';

export interface Subscription {
  id?: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd: boolean;
  cancelAt?: number | null;
}

export interface Invoice {
  id: string;
  number: string | null;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  total: number;
  currency: string;
  created: number;
  pdfUrl: string | null;
  hostedUrl: string | null;
}

export interface PricingTier {
  name: string;
  tier: SubscriptionTier;
  price: number;
  priceId: string;
  popular?: boolean;
  features: string[];
  limits: {
    resources: number | 'unlimited';
    resourceTypes: number | 'all';
    apiRequests: number;
  };
}

export interface CheckoutSessionResponse {
  success: boolean;
  data?: {
    sessionId: string;
    url: string;
  };
  error?: string;
}

export interface SubscriptionResponse {
  success: boolean;
  data?: Subscription;
  error?: string;
}

export interface InvoicesResponse {
  success: boolean;
  data?: Invoice[];
  error?: string;
}

export interface CustomerPortalResponse {
  success: boolean;
  data?: {
    url: string;
  };
  error?: string;
}

export interface CancelSubscriptionResponse {
  success: boolean;
  data?: {
    status: SubscriptionStatus;
    cancelAtPeriodEnd: boolean;
    cancelAt?: number | null;
  };
  error?: string;
}
