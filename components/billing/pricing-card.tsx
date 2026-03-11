'use client';

import { PricingTier } from '@/types/billing';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, ArrowRight, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { createCheckoutSession } from '@/lib/services/stripe.service';
import { toast } from 'sonner';

interface PricingCardProps {
  tier: PricingTier;
  currentTier?: string;
  billingPeriod?: 'monthly' | 'annual';
}

// Tier-specific subtitles and ideal for descriptions
const tierSubtitles: Record<string, { subtitle: string; idealFor: string; roiNote?: string }> = {
  free: {
    subtitle: 'Perfect for side projects',
    idealFor: 'Individual developers & MVPs',
  },
  starter: {
    subtitle: 'Best for growing startups',
    idealFor: 'Teams with $5K-15K monthly AWS spend',
  },
  pro: {
    subtitle: 'For scaling engineering teams',
    idealFor: 'Teams with $15K-75K monthly AWS spend',
    roiNote: 'Typical ROI: Save $2,400/mo = 8x return',
  },
  enterprise: {
    subtitle: 'For large organizations',
    idealFor: '100+ team members, $75K+ AWS spend',
  },
};

export function PricingCard({ tier, currentTier, billingPeriod = 'monthly' }: PricingCardProps) {
  const [loading, setLoading] = useState(false);

  const displayPrice = billingPeriod === 'annual' && tier.annualPrice !== undefined ? tier.annualPrice : tier.price;
  const priceId = billingPeriod === 'annual' && tier.annualPriceId ? tier.annualPriceId : tier.priceId;
  const tierInfo = tierSubtitles[tier.tier] || { subtitle: '', idealFor: '' };

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
  const ctaText = tier.cta || (tier.tier === 'free' ? 'Start Free Forever' : tier.tier === 'enterprise' ? 'Schedule Demo' : 'Start 14-Day Free Trial');

  return (
    <Card
      className={`relative flex flex-col transition-all duration-300 w-full ${
        tier.popular
          ? 'border-2 border-primary shadow-2xl scale-[1.02] hover:scale-[1.04] ring-1 ring-primary/20'
          : 'border hover:shadow-lg hover:scale-[1.02]'
      }`}
    >
      {tier.popular && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2">
          <Badge className="bg-gradient-to-r from-[#7c3aed] to-[#4f46e5] text-white px-4 py-1 shadow-lg">
            Most Popular
          </Badge>
        </div>
      )}

      <CardHeader className="text-center pb-6 pt-8">
        <h3 className="text-2xl font-bold mb-1">{tier.name}</h3>
        {tierInfo.subtitle && (
          <p className="text-sm text-muted-foreground mb-4">{tierInfo.subtitle}</p>
        )}
        <div className="mb-3">
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
          <p className="text-sm text-muted-foreground mt-2">{tier.trialDays}-day free trial</p>
        )}
        {tierInfo.idealFor && (
          <div className="mt-3 px-3 py-2 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Ideal for:</span> {tierInfo.idealFor}
            </p>
          </div>
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

      <CardFooter className="flex-col gap-3">
        <Button
          className={`w-full ${tier.popular ? 'bg-gradient-to-r from-[#7c3aed] to-[#4f46e5] hover:from-[#5851ea] hover:to-[#4338ca]' : ''}`}
          onClick={handleCheckout}
          disabled={loading || isCurrentPlan}
          variant={tier.popular ? 'default' : 'outline'}
          size="lg"
        >
          {loading ? (
            'Loading...'
          ) : isCurrentPlan ? (
            'Current Plan'
          ) : (
            <>
              {ctaText}
              {tier.tier !== 'free' && <ArrowRight className="ml-2 h-4 w-4" />}
            </>
          )}
        </Button>
        {tier.tier !== 'free' && tier.tier !== 'enterprise' && !isCurrentPlan && (
          <p className="text-xs text-muted-foreground text-center">
            No credit card required
          </p>
        )}
        {tier.tier === 'enterprise' && !isCurrentPlan && (
          <p className="text-xs text-muted-foreground text-center">
            Custom pricing & implementation
          </p>
        )}
        {tierInfo.roiNote && (
          <div className="w-full mt-2 p-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-xs text-green-700 dark:text-green-400 text-center font-medium flex items-center justify-center gap-1">
              <Sparkles className="h-3 w-3" />
              {tierInfo.roiNote}
            </p>
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
