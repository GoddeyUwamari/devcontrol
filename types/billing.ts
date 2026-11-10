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
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

/** Application-level payment-failure lifecycle -- independent of Stripe's
 * own `status` above. See backend/src/middleware/subscription.middleware.ts
 * for enforcement and backend/src/controllers/stripe.controller.ts's
 * handleInvoicePaymentFailed/handleInvoicePaid for how it's written. */
export type BillingLifecycleState = 'healthy' | 'grace_period' | 'restricted';

/**
 * The server's billing summary (backend billing-summary.service): every value
 * decided on the server; the page maps nothing from a status to a plan.
 */
export interface BillingPlan {
  /** The plan the organization is on. */
  storedTier: SubscriptionTier;
  /** The plan the server enforces now. */
  effectiveTier: SubscriptionTier;
  entitlementHold: 'payment' | 'subscription_inactive' | null;
  /** A recorded Stripe subscription, a plan our team manages, or neither. */
  source: 'subscription' | 'managed' | 'none';
  isTopPlan: boolean;
}

export interface BillingSubscriptionState {
  status: SubscriptionStatus | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  /** Amount in the currency's minor unit; interval as Stripe reports it. */
  price: { amount: number; currency: string; interval: 'month' | 'year' } | null;
}

export interface BillingTrialState {
  used: boolean;
  active: boolean;
  /** Unix seconds, while a trial is running and its end is known. */
  endsAt: number | null;
  /** The server offers the trial to this organization now (switch on, eligible). */
  eligible: boolean;
}

export interface BillingUsage {
  /** null when it could not be read. limit null means unlimited. */
  awsResources: { used: number; limit: number | null } | null;
}

export interface BillingActions {
  selfServe: 'checkout' | 'change_plan' | 'none';
  showUpgrade: boolean;
  manageSubscription: boolean;
}

export interface Subscription {
  /** The stored plan (also for a plan our team manages). */
  tier: SubscriptionTier;
  /** The recorded subscription's status; null without one. */
  status: SubscriptionStatus | null;
  currentPeriodStart?: number | null;
  currentPeriodEnd?: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt?: number | null;
  plan?: BillingPlan;
  subscription?: BillingSubscriptionState | null;
  trial?: BillingTrialState;
  usage?: BillingUsage;
  actions?: BillingActions;
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
