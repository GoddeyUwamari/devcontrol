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
}

export function PricingCard({ tier, currentTier }: PricingCardProps) {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    if (tier.tier === 'free') {
      toast.info('Already on Free Plan', {
        description: 'You are currently on the free plan.',
      });
      return;
    }

    setLoading(true);

    try {
      const result = await createCheckoutSession(tier.tier, tier.priceId);

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

  return (
    <Card className={`relative flex flex-col ${tier.popular ? 'border-primary shadow-lg' : ''}`}>
      {tier.popular && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary">
          Most Popular
        </Badge>
      )}

      <CardHeader className="text-center pb-8 pt-6">
        <h3 className="text-2xl font-bold mb-2">{tier.name}</h3>
        <div className="mb-4">
          <span className="text-5xl font-bold">${tier.price}</span>
          <span className="text-muted-foreground">/month</span>
        </div>
        {tier.tier !== 'free' && (
          <p className="text-sm text-muted-foreground">14-day free trial</p>
        )}
      </CardHeader>

      <CardContent className="flex-grow">
        <ul className="space-y-3">
          {tier.features.map((feature, index) => (
            <li key={index} className="flex items-start gap-3">
              <Check className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <span className="text-sm">{feature}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 pt-6 border-t space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Resources:</span>
            <span className="font-medium">
              {tier.limits.resources === 'unlimited'
                ? 'Unlimited'
                : `Up to ${tier.limits.resources}`}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">API Requests/hour:</span>
            <span className="font-medium">{tier.limits.apiRequests.toLocaleString()}</span>
          </div>
        </div>
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
            : tier.tier === 'free'
            ? 'Get Started Free'
            : 'Start Free Trial'}
        </Button>
      </CardFooter>
    </Card>
  );
}
