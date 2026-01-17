'use client';

import { PricingCard } from '@/components/billing/pricing-card';
import { BillingToggle } from '@/components/billing/billing-toggle';
import { TrustBadges } from '@/components/billing/trust-badges';
import { FeatureComparisonTable } from '@/components/billing/feature-comparison-table';
import { PricingFAQ } from '@/components/billing/pricing-faq';
import { PricingTier } from '@/types/billing';
import { useEffect, useState } from 'react';
import { getSubscription } from '@/lib/services/stripe.service';
import { Breadcrumb } from '@/components/navigation/breadcrumb';
import { Button } from '@/components/ui/button';

const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Free',
    tier: 'free',
    price: 0,
    priceId: '',
    annualPrice: 0,
    features: [
      'Up to 20 AWS resources',
      'Basic security flags (public/encrypted)',
      'Manual tagging (5 resources at a time)',
      'Total cost visibility',
      'Email support',
    ],
    limits: {
      resources: 20,
      teamMembers: 1,
      apiRequests: 500,
    },
    cta: 'Get Started Free',
  },
  {
    name: 'Starter',
    tier: 'starter',
    price: 79,
    priceId: 'price_starter_monthly',
    annualPrice: 63,
    annualPriceId: 'price_starter_annual',
    annualSavings: 192,
    trialDays: 14,
    features: [
      'Up to 50 AWS resources',
      'Advanced security scanning',
      'Cost attribution by team/service',
      'Orphaned resource detection',
      'Savings recommendations',
      'Bulk tagging (25 at a time)',
      'Export reports (CSV/PDF)',
      'Email & Slack alerts',
      'Priority email support',
    ],
    limits: {
      resources: 50,
      teamMembers: 5,
      apiRequests: 2000,
    },
    cta: 'Start Free Trial',
  },
  {
    name: 'Pro',
    tier: 'pro',
    price: 299,
    priceId: 'price_1Skm2eH8pNFfrvRPLh2mgf6l',
    annualPrice: 239,
    annualPriceId: 'price_pro_annual',
    annualSavings: 720,
    popular: true,
    trialDays: 14,
    features: [
      'Up to 500 AWS resources',
      'Compliance scanning (SOC 2, HIPAA, PCI)',
      'Full cost attribution & analytics',
      'Risk score & trend analysis',
      'Unlimited bulk actions',
      'Advanced reports & dashboards',
      'Ticket creation (Jira/Linear)',
      'Multi-channel alerts',
      'Priority support with SLA',
    ],
    limits: {
      resources: 500,
      teamMembers: 10,
      apiRequests: 5000,
    },
    cta: 'Start Free Trial',
  },
  {
    name: 'Enterprise',
    tier: 'enterprise',
    price: 1499,
    priceId: 'price_1Skm4iH8pNFfrvRPa6nDnjqc',
    annualPrice: 1199,
    annualPriceId: 'price_enterprise_annual',
    annualSavings: 3600,
    trialDays: 14,
    features: [
      'Unlimited AWS resources',
      'Custom compliance frameworks',
      'Auto-remediation workflows',
      'Bulk remediation actions',
      'Scheduled compliance reports',
      'Full API access',
      'SSO/SAML authentication',
      'Dedicated account manager',
      '99.9% uptime SLA',
    ],
    limits: {
      resources: 'Unlimited',
      teamMembers: 'Unlimited',
      apiRequests: 20000,
    },
    cta: 'Contact Sales',
    addOns: [
      { name: 'White-label', price: 500 },
      { name: 'Dedicated Account Manager', price: 1000 },
    ],
  },
];

export default function PricingPage() {
  const [currentTier, setCurrentTier] = useState<string>('free');
  const [loading, setLoading] = useState(true);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');

  useEffect(() => {
    async function fetchSubscription() {
      try {
        const result = await getSubscription();
        if (result.success && result.data) {
          setCurrentTier(result.data.tier);
        }
      } catch (error) {
        console.error('Error fetching subscription:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchSubscription();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto px-4 py-16">
        {/* Breadcrumb */}
        <div className="mb-8">
          <Breadcrumb
            items={[
              { label: 'Home', href: '/dashboard' },
              { label: 'Pricing', current: true },
            ]}
          />
        </div>

        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Choose the plan that fits your team&apos;s needs. Start free, upgrade anytime.
          </p>
        </div>

        {/* Billing Toggle */}
        <BillingToggle value={billingPeriod} onChange={setBillingPeriod} />

        {/* Pricing Cards */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="text-muted-foreground">Loading pricing...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto mb-16">
            {PRICING_TIERS.map((tier) => (
              <PricingCard
                key={tier.tier}
                tier={tier}
                currentTier={currentTier}
                billingPeriod={billingPeriod}
              />
            ))}
          </div>
        )}

        {/* Trust Badges */}
        <TrustBadges />

        {/* Feature Comparison Table */}
        <FeatureComparisonTable />

        {/* FAQ Section */}
        <PricingFAQ />

        {/* Final CTA Section */}
        <div className="mt-16 text-center bg-gradient-to-br from-primary/10 via-primary/5 to-background rounded-2xl p-12 border border-primary/20 max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join thousands of teams already managing their AWS resources with DevControl.
            Start your 14-day free trial today.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="bg-primary hover:bg-primary/90">
              Start Free Trial
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => (window.location.href = 'mailto:sales@devcontrol.app')}
            >
              Contact Sales
            </Button>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Questions? Email us at{' '}
            <a
              href="mailto:sales@devcontrol.app"
              className="text-primary hover:underline font-medium"
            >
              sales@devcontrol.app
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
