'use client';

import { PricingTier } from '@/types/billing';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { createCheckoutSession } from '@/lib/services/stripe.service';
import { toast } from 'sonner';

interface PricingCardProps {
  tier: PricingTier;
  currentTier?: string;
  billingPeriod?: 'monthly' | 'annual';
}

export function PricingCard({ tier, currentTier, billingPeriod = 'monthly' }: PricingCardProps) {
  const [loading, setLoading] = useState(false);

  const displayPrice = billingPeriod === 'annual' && tier.annualPrice !== undefined ? tier.annualPrice : tier.price;
  const priceId = billingPeriod === 'annual' && tier.annualPriceId ? tier.annualPriceId : tier.priceId;

  const handleCheckout = async () => {
    if (tier.tier === 'free') {
      toast.info('Already on Free Plan', {
        description: 'You are currently on the free plan.',
      });
      return;
    }

    if (tier.tier === 'enterprise') {
      window.location.href = 'mailto:sales@devcontrol.app';
      return;
    }

    setLoading(true);

    try {
      const result = await createCheckoutSession(tier.tier, priceId);

      if (result.success && result.data?.url) {
        // Redirect to Stripe Checkout
        window.location.href = result.data.url;
      } else {
        toast.error('Error', {
          description: result.error || 'Failed to start checkout',
        });
        setLoading(false);
      }
    } catch (error: any) {
      toast.error('Error', {
        description: error.message || 'Failed to start checkout',
      });
      setLoading(false);
    }
  };

  const isCurrentPlan = currentTier === tier.tier;
  const ctaText = tier.cta || (tier.tier === 'free' ? 'Get Started Free' : tier.tier === 'enterprise' ? 'Contact Sales' : 'Start Free Trial');

  return (
    <Card
      className={`relative flex flex-col transition-all duration-300 ${
        tier.popular
          ? 'border-2 border-primary shadow-2xl scale-[1.02] hover:scale-[1.04]'
          : 'border hover:shadow-lg hover:scale-[1.02]'
      }`}
    >
      {tier.popular && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <Badge className="bg-gradient-to-r from-[#635BFF] to-[#4f46e5] text-white px-4 py-1 shadow-lg">
            Most Popular
          </Badge>
        </div>
      )}

      <CardHeader className="text-center pb-8 pt-8">
        <h3 className="text-2xl font-bold mb-2">{tier.name}</h3>
        <div className="mb-2">
          {tier.tier === 'enterprise' && (
            <div className="text-sm text-muted-foreground font-normal mb-1">Starting at</div>
          )}
          <div>
            <span className="text-5xl font-bold">${displayPrice.toLocaleString()}</span>
            <span className="text-muted-foreground">/month</span>
          </div>
        </div>
        {billingPeriod === 'annual' && tier.annualSavings && (
          <p className="text-sm text-green-600 dark:text-green-400 font-semibold">
            Save ${tier.annualSavings.toLocaleString()}/year
          </p>
        )}
        {tier.trialDays && tier.tier !== 'free' && (
          <p className="text-sm text-muted-foreground mt-1">{tier.trialDays}-day free trial</p>
        )}
      </CardHeader>

      <CardContent className="flex-grow">
        <ul className="space-y-3 mb-6">
          {tier.features.map((feature, index) => (
            <li key={index} className="flex items-start gap-3">
              <Check className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
              <span className="text-sm">{feature}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 pt-6 border-t space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Resources:</span>
            <span className="font-medium">
              {typeof tier.limits.resources === 'string' && tier.limits.resources !== 'unlimited'
                ? tier.limits.resources
                : tier.limits.resources === 'unlimited'
                ? 'Unlimited'
                : `Up to ${tier.limits.resources}`}
            </span>
          </div>
          {tier.limits.teamMembers && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Team Members:</span>
              <span className="font-medium">
                {tier.limits.teamMembers === 'unlimited' || tier.limits.teamMembers === 'Unlimited'
                  ? 'Unlimited'
                  : tier.limits.teamMembers}
              </span>
            </div>
          )}
          {tier.limits.apiRequests && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">API Requests/hour:</span>
              <span className="font-medium">{tier.limits.apiRequests.toLocaleString()}</span>
            </div>
          )}
        </div>

        {tier.addOns && tier.addOns.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Add-ons:</p>
            <ul className="space-y-1">
              {tier.addOns.map((addon, index) => (
                <li key={index} className="text-xs text-muted-foreground">
                  {addon.name}: +${addon.price}/mo
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <CardFooter>
        <Button
          className="w-full"
          onClick={handleCheckout}
          disabled={loading || isCurrentPlan}
          variant={tier.popular ? 'default' : 'outline'}
        >
          {loading
            ? 'Loading...'
            : isCurrentPlan
            ? 'Current Plan'
            : ctaText}
        </Button>
      </CardFooter>
    </Card>
  );
}
