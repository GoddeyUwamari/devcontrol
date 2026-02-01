'use client';

import { useEffect, useState } from 'react';
import { PricingTier } from '@/types/billing';
import { PricingCard } from '@/components/billing/pricing-card';
import { BillingToggle } from '@/components/billing/billing-toggle';
import { FeatureComparisonTable } from '@/components/billing/feature-comparison-table';
import { PricingFAQ } from '@/components/billing/pricing-faq';
import { TrustBadges } from '@/components/billing/trust-badges';
import { PricingROI } from '@/components/pricing/pricing-roi';
// REMOVED: Fake testimonials - legal compliance
// import { PricingTestimonials } from '@/components/pricing/pricing-testimonials';
import { getSubscription } from '@/lib/services/stripe.service';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Footer } from '@/components/footer';
import { Breadcrumb } from '@/components/navigation/breadcrumb';
import {
  Sparkles,
  Shield,
  Clock,
  CheckCircle2,
  ArrowRight,
  Calculator
} from 'lucide-react';

const pricingTiers: PricingTier[] = [
  {
    name: 'Free',
    tier: 'free',
    price: 0,
    priceId: 'free',
    trialDays: 0,
    features: [
      'Up to 20 AWS resources',
      '3 resource types (EC2, RDS, S3)',
      'Basic cost visibility',
      'Email alerts',
      'Community support',
    ],
    limits: {
      resources: 20,
      resourceTypes: 3,
      apiRequests: 500,
      teamMembers: 1,
    },
    cta: 'Start Free Forever',
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
      'Up to 60 AWS resources',
      '10 resource types',
      'Cost attribution by team',
      'Orphaned resource detection',
      'Savings recommendations',
      'Export reports (CSV/PDF)',
      'Up to 5 team members',
      'Priority email support',
    ],
    limits: {
      resources: 60,
      resourceTypes: 10,
      apiRequests: 2000,
      teamMembers: 5,
    },
    cta: 'Start 14-Day Free Trial',
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
      '✨ AI Chat Assistant (unlimited queries)',
      '✨ Anomaly Detection (4 detection types)',
      '✨ Natural Language Search',
      '✨ AI Cost Optimization (7 types)',
      '✨ On-Demand AI Reports',
      '✨ Smart AI Recommendations',
      '───────────────',
      'Up to 500 AWS resources',
      'All resource types',
      'Compliance scanning (SOC 2, HIPAA)',
      'Risk score & trends',
      'Slack & Jira integrations',
      'Up to 10 team members',
      'Priority support (4hr response)',
    ],
    limits: {
      resources: 500,
      resourceTypes: 'all',
      apiRequests: 5000,
      teamMembers: 10,
    },
    cta: 'Start 14-Day Free Trial',
  },
  {
    name: 'Enterprise',
    tier: 'enterprise',
    price: 1499,
    priceId: 'price_1Skm4iH8pNFfrvRPa6nDnjqc',
    trialDays: 14,
    features: [
      '✨ Everything in Pro',
      '✨ Scheduled AI Reports (weekly/monthly)',
      '✨ Weekly AI Email Summaries',
      '✨ Custom Anomaly Detection Rules',
      '✨ Advanced AI Insights',
      '───────────────',
      'Unlimited AWS resources',
      'All resource types',
      'Custom compliance frameworks',
      'Auto-remediation workflows',
      'Full API access',
      'SSO/SAML authentication',
      'Dedicated account manager',
      '99.99% uptime SLA',
      '24/7 priority support',
    ],
    limits: {
      resources: 'unlimited',
      resourceTypes: 'all',
      apiRequests: 20000,
      teamMembers: 'Unlimited',
    },
    cta: 'Schedule Demo',
    addOns: [
      { name: 'Additional API requests', price: 99 },
      { name: 'Custom integrations', price: 299 },
    ],
  },
];

export default function PricingPage() {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
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
    <div className="min-h-screen bg-background">
      {/* Hero Section - Strong Value Prop */}
      <section className="relative overflow-hidden">
        {/* Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-indigo-50/50 to-background dark:from-blue-950/20 dark:via-indigo-950/10 dark:to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-100/40 via-transparent to-transparent dark:from-blue-900/20" />

        {/* Breadcrumb Navigation */}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <Breadcrumb
            items={[
              { label: 'Home', href: '/' },
              { label: 'Pricing', current: true },
            ]}
          />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-12">
          <div className="text-center max-w-4xl mx-auto">
            {/* Trust Signal */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-medium mb-6">
              <CheckCircle2 className="w-4 h-4" />
              <span>Average $2,400/month AWS savings</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
              AI-Powered DevOps,{' '}
              <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Human-Friendly Pricing
              </span>
            </h1>

            {/* Subheadline with ROI */}
            <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto">
              The only platform with{' '}
              <span className="font-semibold text-purple-600 dark:text-purple-400">6 AI features</span> built-in.
              <br className="hidden sm:block" />
              Cut AWS costs <span className="font-semibold text-green-600 dark:text-green-400">30%</span>, deploy <span className="font-semibold text-blue-600 dark:text-blue-400">2x faster</span>.
            </p>

            {/* Quick Value Props */}
            <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground mb-8">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600" />
                <span>3-minute setup</span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-green-600" />
                <span>Read-only AWS access</span>
              </div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <span>No credit card required</span>
              </div>
            </div>

            {/* CTA Link */}
            <a
              href="#pricing-cards"
              className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium transition-colors"
            >
              <Calculator className="w-4 h-4" />
              Calculate your potential savings
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* ROI Section */}
      <section className="py-12 md:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <PricingROI />
        </div>
      </section>

      {/* Pricing Cards Section */}
      <section id="pricing-cards" className="py-12 md:py-16 scroll-mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section Header */}
          <div className="text-center mb-8">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              AI-Powered Plans for Every Team
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Get AI-driven insights, anomaly detection, and cost optimization. All paid plans include a 14-day free trial.
            </p>
          </div>

          {/* Billing Toggle */}
          <BillingToggle value={billingPeriod} onChange={setBillingPeriod} />

          {/* Pricing Cards Grid */}
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <div className="text-muted-foreground">Loading pricing...</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 lg:gap-8">
              {pricingTiers.map((tier) => (
                <div key={tier.tier} className="flex">
                  <PricingCard
                    tier={tier}
                    currentTier={currentTier}
                    billingPeriod={billingPeriod}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Trust Indicators Below Cards */}
          <div className="mt-12 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              All paid plans include a <span className="font-semibold">14-day money-back guarantee</span>
            </p>
            <div className="flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                Cancel anytime
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                No hidden fees
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                Instant access
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* REMOVED: Testimonials Section - fake testimonials removed for legal compliance */}

      {/* Feature Comparison Table */}
      <section className="py-12 md:py-16">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <FeatureComparisonTable />
        </div>
      </section>

      {/* Trust Badges */}
      <TrustBadges />

      {/* FAQ Section */}
      <section className="py-12 md:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <PricingFAQ />
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl border border-blue-500 p-10 md:p-16 text-center relative overflow-hidden">
            {/* Background Pattern */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,_rgba(255,255,255,0.1)_0%,_transparent_50%)]" />

            <div className="relative">
              <Badge className="mb-6 bg-white/20 text-white border-white/30 hover:bg-white/30">
                Start saving today
              </Badge>

              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4">
                Ready to Optimize Your AWS Costs?
              </h2>

              <p className="text-lg md:text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
                Join hundreds of teams who reduced their cloud spend by 20% or more with DevControl
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
                <Button
                  size="lg"
                  variant="secondary"
                  className="px-8 py-6 text-base font-semibold bg-white text-blue-600 hover:bg-blue-50 w-full sm:w-auto"
                >
                  Start Free 14-Day Trial
                  <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="px-8 py-6 text-base font-semibold border-white text-white hover:bg-white/10 w-full sm:w-auto"
                >
                  Schedule Demo
                </Button>
              </div>

              {/* Trust Elements */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-blue-100">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Setup in 3 minutes</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Cancel anytime</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
}
