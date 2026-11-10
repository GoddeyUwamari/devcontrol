'use client';

import { useState } from 'react';
import { Subscription } from '@/types/billing';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, CreditCard, TrendingUp } from 'lucide-react';
import { openCustomerPortal } from '@/lib/services/stripe.service';
import { useIsBillingAdmin } from '@/lib/hooks/use-current-role';
import { PLAN_DISPLAY_NAME, type PaidTier } from '@/lib/plan/plan-names';

/** Unix seconds as "Month D, YYYY". */
export function formatBillingDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** A Stripe amount (minor unit) as "$49" or "$40.83". */
export function formatPriceAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}

/** The customer-facing plan name; never the internal tier id. */
export function planDisplayName(tier: string): string {
  return Object.prototype.hasOwnProperty.call(PLAN_DISPLAY_NAME, tier)
    ? PLAN_DISPLAY_NAME[tier as PaidTier]
    : 'Free';
}

interface SubscriptionStatusProps {
  subscription: Subscription;
}

export function SubscriptionStatus({ subscription }: SubscriptionStatusProps) {
  const [portalLoading, setPortalLoading] = useState(false);
  // Opening the Customer Portal is owner/admin-only server-side
  // (StripeController.requireBillingAdmin) -- hide the trial banner's
  // portal-triggering button for the same roles.
  const canManageBilling = useIsBillingAdmin();

  const handleOpenPortal = async () => {
    setPortalLoading(true);
    try {
      const result = await openCustomerPortal();
      if (result.success && result.data?.url) {
        window.location.href = result.data.url;
      }
    } finally {
      setPortalLoading(false);
    }
  };

  const plan = subscription.plan;
  const managed = plan?.source === 'managed';
  const trial = subscription.trial;
  const price = subscription.subscription?.price ?? null;
  const trialEndsAt = trial?.active && trial.endsAt ? formatBillingDate(trial.endsAt) : null;

  const getStatusBadge = () => {
    if (managed) return <Badge variant="secondary">Managed</Badge>;
    if (subscription.status === null && subscription.tier === 'free') {
      return <Badge variant="secondary">Free</Badge>;
    }
    switch (subscription.status) {
      case 'active':
        return <Badge className="bg-green-500">Active</Badge>;
      case 'trialing':
        return <Badge className="bg-blue-500">Trial Active</Badge>;
      case 'canceled':
        return <Badge variant="destructive">Canceled</Badge>;
      case 'past_due':
        return <Badge variant="destructive">Past Due</Badge>;
      case 'free':
        return <Badge variant="secondary">Free</Badge>;
      default:
        return <Badge variant="outline">{subscription.status}</Badge>;
    }
  };

  const getTierDisplay = () => planDisplayName(subscription.tier);

  const getNextBillingDate = () => {
    const fmt = formatBillingDate;

    if (subscription.cancelAtPeriodEnd) {
      return subscription.currentPeriodEnd
        ? fmt(subscription.currentPeriodEnd)
        : 'end of billing period';
    }

    if (subscription.cancelAt) return fmt(subscription.cancelAt);

    return subscription.currentPeriodEnd
      ? fmt(subscription.currentPeriodEnd)
      : 'end of billing period';
  };

  const formatGraceEndsAt = () => {
    if (!subscription.graceEndsAt) return 'soon';
    return new Date(subscription.graceEndsAt * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // isRestricted (grace expired, or explicitly restricted) always takes
  // precedence over a still-active grace period -- the two states are
  // mutually exclusive by construction (see subscription.middleware.ts's
  // isOrgRestricted), but checking isRestricted first here keeps that
  // invariant true even if the API response is ever inconsistent.
  // The payment hold comes from the server's decision (plan.entitlementHold)
  // when the summary carries it; isRestricted is the older field.
  const isRestricted = plan ? plan.entitlementHold === 'payment' : subscription.isRestricted === true;
  const inGracePeriod = !isRestricted && subscription.isRestricted !== true && subscription.billingLifecycleState === 'grace_period';
  const subscriptionInactive = plan?.entitlementHold === 'subscription_inactive';

  return (
    <>
      {isRestricted && (
        <div
          style={{
            backgroundColor: 'rgba(220, 38, 38, 0.08)',
            border: '1px solid #DC2626',
            borderRadius: '0.75rem',
            padding: '0.875rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <p style={{ fontSize: '0.875rem', color: '#991b1b', margin: 0, lineHeight: 1.4 }}>
            <strong>Access restricted due to a payment issue.</strong>
            {' '}Your {getTierDisplay()} plan and billing history are preserved -- resolve
            payment to restore full access.
            {!canManageBilling && ' Ask an organization owner or admin to update billing.'}
          </p>
          {canManageBilling && (
            <button
              onClick={handleOpenPortal}
              disabled={portalLoading}
              style={{
                flexShrink: 0,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#991b1b',
                border: '1px solid #DC2626',
                borderRadius: '0.5rem',
                padding: '0.375rem 0.75rem',
                background: 'transparent',
                cursor: portalLoading ? 'not-allowed' : 'pointer',
                opacity: portalLoading ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {portalLoading ? 'Loading…' : 'Manage Billing'}
            </button>
          )}
        </div>
      )}

      {inGracePeriod && (
        <div
          style={{
            backgroundColor: 'rgba(217, 119, 6, 0.10)',
            border: '1px solid #D97706',
            borderRadius: '0.75rem',
            padding: '0.875rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <p style={{ fontSize: '0.875rem', color: '#92400e', margin: 0, lineHeight: 1.4 }}>
            <strong>We couldn&apos;t process your last payment.</strong>
            {' '}Your {getTierDisplay()} plan remains active until{' '}
            <strong>{formatGraceEndsAt()}</strong>. Update your payment method before then to
            avoid restricted access.
            {!canManageBilling && ' Ask an organization owner or admin to update billing.'}
          </p>
          {canManageBilling && (
            <button
              onClick={handleOpenPortal}
              disabled={portalLoading}
              style={{
                flexShrink: 0,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#92400e',
                border: '1px solid #D97706',
                borderRadius: '0.5rem',
                padding: '0.375rem 0.75rem',
                background: 'transparent',
                cursor: portalLoading ? 'not-allowed' : 'pointer',
                opacity: portalLoading ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {portalLoading ? 'Loading…' : 'Manage Billing'}
            </button>
          )}
        </div>
      )}

      {subscriptionInactive && (
        <div
          style={{
            backgroundColor: 'rgba(220, 38, 38, 0.08)',
            border: '1px solid #DC2626',
            borderRadius: '0.75rem',
            padding: '0.875rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <p style={{ fontSize: '0.875rem', color: '#991b1b', margin: 0, lineHeight: 1.4 }}>
            Your {getTierDisplay()} subscription isn&apos;t active, so paid features are paused. Complete or
            resume it in Manage Billing.
            {!canManageBilling && ' Ask an organization owner or admin to update billing.'}
          </p>
          {canManageBilling && (
            <button
              onClick={handleOpenPortal}
              disabled={portalLoading}
              style={{
                flexShrink: 0,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#991b1b',
                border: '1px solid #DC2626',
                borderRadius: '0.5rem',
                padding: '0.375rem 0.75rem',
                background: 'transparent',
                cursor: portalLoading ? 'not-allowed' : 'pointer',
                opacity: portalLoading ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {portalLoading ? 'Loading…' : 'Manage Billing'}
            </button>
          )}
        </div>
      )}

      {trialEndsAt && (
        <div
          style={{
            backgroundColor: 'rgba(217, 119, 6, 0.10)',
            border: '1px solid #D97706',
            borderRadius: '0.75rem',
            padding: '0.875rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <p style={{ fontSize: '0.875rem', color: '#92400e', margin: 0, lineHeight: 1.4 }}>
            <strong>Trial ends on {trialEndsAt}.</strong>
            {' '}Your card on file will be charged then unless you cancel.
          </p>
          {canManageBilling && (
            <button
              onClick={handleOpenPortal}
              disabled={portalLoading}
              style={{
                flexShrink: 0,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#92400e',
                border: '1px solid #D97706',
                borderRadius: '0.5rem',
                padding: '0.375rem 0.75rem',
                background: 'transparent',
                cursor: portalLoading ? 'not-allowed' : 'pointer',
                opacity: portalLoading ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {portalLoading ? 'Loading…' : 'Manage Billing'}
            </button>
          )}
        </div>
      )}
      <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Current Plan
          </CardTitle>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Plan Details */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Plan:</span>
            <span className="text-2xl font-bold">{getTierDisplay()}</span>
          </div>

          {managed && (
            <p className="text-sm text-muted-foreground">Managed by our team</p>
          )}

          {!managed && subscription.tier === 'free' && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Price:</span>
              <span className="text-xl font-semibold">
                $0
                <span className="text-sm text-muted-foreground">/month</span>
              </span>
            </div>
          )}

          {!managed && subscription.tier !== 'free' && price && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Price:</span>
              <span className="text-xl font-semibold">
                {formatPriceAmount(price.amount, price.currency)}
                <span className="text-sm text-muted-foreground">/{price.interval}</span>
              </span>
            </div>
          )}

          {!managed && subscription.tier !== 'free' && (
            <>
              {price && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Billing Cycle:
                  </span>
                  <span className="font-medium">{price.interval === 'year' ? 'Annual' : 'Monthly'}</span>
                </div>
              )}

              {subscription.currentPeriodEnd && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">
                    {subscription.cancelAtPeriodEnd ? 'Access until:' : 'Next billing:'}
                  </span>
                  <span className="font-medium">{getNextBillingDate()}</span>
                </div>
              )}

              {subscription.cancelAtPeriodEnd && (
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                  <p className="text-sm text-amber-800 dark:text-amber-300">
                    Your subscription will be cancelled on {getNextBillingDate()}. You'll
                    be downgraded to the Free plan.
                  </p>
                </div>
              )}

              {trialEndsAt && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                  <div className="flex items-start gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                        Trial Period Active
                      </p>
                      <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                        {price
                          ? `Trial ends on ${trialEndsAt}. After that you'll be charged ${formatPriceAmount(price.amount, price.currency)} per ${price.interval}.`
                          : `Trial ends on ${trialEndsAt}.`}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
    </>
  );
}
