'use client';

import { Subscription } from '@/types/billing';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, CreditCard, TrendingUp } from 'lucide-react';

interface SubscriptionStatusProps {
  subscription: Subscription;
}

export function SubscriptionStatus({ subscription }: SubscriptionStatusProps) {
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
      starter: 199,
      pro: 499,
      enterprise: 1999,
    };
    return prices[subscription.tier] || 0;
  };

  const getNextBillingDate = () => {
    if (!subscription.currentPeriodEnd) return 'N/A';
    return new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
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
  );
}
