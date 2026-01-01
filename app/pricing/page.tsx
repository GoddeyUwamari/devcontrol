'use client';

import { PricingCard } from '@/components/billing/pricing-card';
import { PricingTier } from '@/types/billing';
import { useEffect, useState } from 'react';
import { getSubscription } from '@/lib/services/stripe.service';
import { Breadcrumb } from '@/components/navigation/breadcrumb';

const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Starter',
    tier: 'starter',
    price: 199,
    priceId: 'price_1Skm0uH8pNFfrvRPuccIDLoA',
    features: [
      'Up to 50 AWS resources',
      '3 resource types (EC2, RDS, S3)',
      'Manual tagging',
      'Email support',
      '1,000 API requests/hour',
      '14-day free trial',
    ],
    limits: {
      resources: 50,
      resourceTypes: 3,
      apiRequests: 1000,
    },
  },
  {
    name: 'Pro',
    tier: 'pro',
    price: 499,
    priceId: 'price_1Skm2eH8pNFfrvRPLh2mgf6l',
    popular: true,
    features: [
      'Up to 500 AWS resources',
      'All 7 resource types',
      'Bulk tagging operations',
      'Compliance scanning',
      'Security audits',
      'Priority support',
      '5,000 API requests/hour',
      '14-day free trial',
    ],
    limits: {
      resources: 500,
      resourceTypes: 'all',
      apiRequests: 5000,
    },
  },
  {
    name: 'Enterprise',
    tier: 'enterprise',
    price: 1999,
    priceId: 'price_1Skm4iH8pNFfrvRPa6nDnjqc',
    features: [
      'Unlimited AWS resources',
      'All 7 resource types',
      'Custom compliance rules',
      'Advanced security scanning',
      'Dedicated support',
      'Custom integrations',
      '20,000 API requests/hour',
      'SSO/SAML support',
      '14-day free trial',
    ],
    limits: {
      resources: 'unlimited',
      resourceTypes: 'all',
      apiRequests: 20000,
    },
  },
];

export default function PricingPage() {
  const [currentTier, setCurrentTier] = useState<string>('free');
  const [loading, setLoading] = useState(true);

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

        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Choose the perfect plan for your AWS resource management needs.
            Start with a 14-day free trial, no credit card required.
          </p>
        </div>

        {/* Pricing Cards */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="text-muted-foreground">Loading pricing...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto">
            {PRICING_TIERS.map((tier) => (
              <PricingCard key={tier.tier} tier={tier} currentTier={currentTier} />
            ))}
          </div>
        )}

        {/* FAQ or Additional Info */}
        <div className="mt-20 text-center">
          <h2 className="text-2xl font-bold mb-8">Frequently Asked Questions</h2>
          <div className="max-w-3xl mx-auto space-y-6 text-left">
            <div className="bg-card p-6 rounded-lg border">
              <h3 className="font-semibold mb-2">Can I change plans later?</h3>
              <p className="text-muted-foreground">
                Yes! You can upgrade or downgrade your plan at any time. Changes are
                prorated, so you only pay for what you use.
              </p>
            </div>

            <div className="bg-card p-6 rounded-lg border">
              <h3 className="font-semibold mb-2">What payment methods do you accept?</h3>
              <p className="text-muted-foreground">
                We accept all major credit cards (Visa, MasterCard, American Express)
                through our secure payment processor, Stripe.
              </p>
            </div>

            <div className="bg-card p-6 rounded-lg border">
              <h3 className="font-semibold mb-2">Can I cancel anytime?</h3>
              <p className="text-muted-foreground">
                Absolutely! You can cancel your subscription at any time. Your access will
                continue until the end of your current billing period.
              </p>
            </div>

            <div className="bg-card p-6 rounded-lg border">
              <h3 className="font-semibold mb-2">Is there a long-term contract?</h3>
              <p className="text-muted-foreground">
                No long-term contracts required. All plans are billed monthly and you can
                cancel anytime without penalties.
              </p>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="mt-20 text-center bg-primary/5 rounded-2xl p-12 border border-primary/20">
          <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Join thousands of teams already managing their AWS resources with DevControl.
            Start your 14-day free trial today.
          </p>
        </div>
      </div>
    </div>
  );
}
