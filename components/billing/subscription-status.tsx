'use client';

import { useState } from 'react';
import { Subscription } from '@/types/billing';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, CreditCard, TrendingUp } from 'lucide-react';
import { openCustomerPortal } from '@/lib/services/stripe.service';

interface SubscriptionStatusProps {
  subscription: Subscription;
}

export function SubscriptionStatus({ subscription }: SubscriptionStatusProps) {
  const [portalLoading, setPortalLoading] = useState(false);

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

  const getTrialDaysRemaining = () => {
    if (!subscription.currentPeriodEnd) return 0;
    const msRemaining = subscription.currentPeriodEnd * 1000 - Date.now();
    return Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
  };
  const getStatusBadge = () => {
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

  const getTierDisplay = () => {
    return subscription.tier.charAt(0).toUpperCase() + subscription.tier.slice(1);
  };

  const getPriceDisplay = () => {
    const prices: Record<string, number> = {
      free: 0,
      starter: 49,
      pro: 199,
      enterprise: 999,
    };
    return prices[subscription.tier] || 0;
  };

  const getNextBillingDate = () => {
    const fmt = (ts: number) =>
      new Date(ts * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

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

  return (
    <>
      {subscription.status === 'trialing' && (
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
          }}
        >
          <p style={{ fontSize: '0.875rem', color: '#92400e', margin: 0, lineHeight: 1.4 }}>
            <strong>Your trial ends in {getTrialDaysRemaining()} days</strong>
            {' '}— add a payment method to keep access.
          </p>
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
            {portalLoading ? 'Loading…' : 'Add payment method'}
          </button>
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

          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Price:</span>
            <span className="text-xl font-semibold">
              ${getPriceDisplay()}
              <span className="text-sm text-muted-foreground">/month</span>
            </span>
          </div>

          {subscription.tier !== 'free' && (
            <>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Billing Cycle:
                </span>
                <span className="font-medium">Monthly recurring</span>
              </div>

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

              {subscription.status === 'trialing' && subscription.currentPeriodEnd && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                  <div className="flex items-start gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                        Trial Period Active
                      </p>
                      <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                        Your free trial ends on {getNextBillingDate()}. You'll be charged
                        ${getPriceDisplay()} after the trial period.
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
