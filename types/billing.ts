/**
 * Billing and Stripe-related TypeScript types
 */

export type SubscriptionTier = 'free' | 'starter' | 'pro' | 'enterprise';

/** Billing cadence for Checkout. Never carries a Stripe Price ID -- the
 * server resolves the actual price from (tier, billingInterval). */
export type BillingInterval = 'monthly' | 'annual';

export type SubscriptionStatus =
  | 'free'
  | 'active'
  | 'trialing'
  | 'canceled'
  | 'past_due'
  | 'unpaid';

/** Application-level payment-failure lifecycle -- independent of Stripe's
 * own `status` above. See backend/src/middleware/subscription.middleware.ts
 * for enforcement and backend/src/controllers/stripe.controller.ts's
 * handleInvoicePaymentFailed/handleInvoicePaid for how it's written. */
export type BillingLifecycleState = 'healthy' | 'grace_period' | 'restricted';

export interface Subscription {
  id?: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd: boolean;
  cancelAt?: number | null;
  /** Always the organization's real paid tier, even while restricted --
   * only isRestricted governs actual product access, never this field. */
  billingLifecycleState?: BillingLifecycleState;
  paymentFailedAt?: number | null;
  graceEndsAt?: number | null;
  /** True once the grace period has actually expired (state 'restricted',
   * or 'grace_period' past its deadline) -- what the UI should key off of,
   * rather than re-deriving it from graceEndsAt/Date.now() itself. */
  isRestricted?: boolean;
}

export interface Invoice {
  id: string;
  number: string | null;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  amount_paid: number;
  currency: string;
  created: number;
  pdfUrl: string | null;
  hostedUrl: string | null;
  amount_refunded: number;
  refund_status: 'full' | 'partial' | null;
}

export interface PricingTier {
  name: string;
  tier: SubscriptionTier;
  price: number;
  priceId: string;
  annualPrice?: number;
  annualPriceId?: string;
  annualSavings?: number;
  popular?: boolean;
  trialDays?: number;
  features: string[];
  limits: {
    resources: number | 'unlimited' | string;
    resourceTypes?: number | 'all';
    apiRequests?: number;
    teamMembers?: number | 'unlimited' | string;
  };
  cta?: string;
  addOns?: Array<{ name: string; price: number }>;
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

export interface ChangePlanResponse {
  success: boolean;
  data?: {
    status: SubscriptionStatus;
    tier: SubscriptionTier;
    billingInterval: BillingInterval;
  };
  error?: string;
}
