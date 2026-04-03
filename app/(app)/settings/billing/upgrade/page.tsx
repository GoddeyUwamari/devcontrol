'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Zap, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { createCheckoutSession } from '@/lib/services/stripe.service'
import Link from 'next/link'

const plans = [
  {
    name: 'Starter',
    tier: 'starter',
    price: 79,
    annualPrice: 63,
    priceId: 'price_1Skm0uH8pNFfrvRPuccIDLoA',
    annualPriceId: 'price_starter_annual',
    description: 'For small teams getting started with AWS visibility',
    features: [
      'Up to 60 AWS resources',
      '15 resource types',
      'Cost attribution by team',
      'Orphaned resource detection',
      'Savings recommendations',
      'Up to 5 team members',
      'Email support',
    ],
  },
  {
    name: 'Pro',
    tier: 'pro',
    price: 299,
    annualPrice: 239,
    priceId: 'price_1TIANxH8pNFfrvRPngDy6iGc',
    annualPriceId: 'price_pro_annual',
    popular: true,
    description: 'For growing teams that need AI-powered optimization',
    features: [
      'Up to 500 AWS resources',
      'AI Cost Optimization',
      'AI Chat Assistant',
      'Anomaly Detection',
      'Natural Language Search',
      'Compliance scanning (SOC 2, HIPAA)',
      'DORA metrics',
      'Slack & Jira integrations',
      'Up to 10 team members',
      'Priority support',
    ],
  },
  {
    name: 'Enterprise',
    tier: 'enterprise',
    price: 1499,
    priceId: 'price_1Skm4iH8pNFfrvRPa6nDnjqc',
    description: 'For large organizations needing full control',
    features: [
      'Unlimited AWS resources',
      'Everything in Pro',
      'Custom compliance frameworks',
      'Auto-remediation workflows',
      'SSO/SAML authentication',
      'Multi-account monitoring',
      'Dedicated account manager',
      '24/7 priority support',
    ],
  },
]

export default function UpgradePage() {
  const router = useRouter()
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly')
  const [loadingTier, setLoadingTier] = useState<string | null>(null)

  const handleUpgrade = async (plan: typeof plans[0]) => {
    if (plan.tier === 'enterprise') {
      router.push('/contact')
      return
    }

    const priceId = billing === 'annual' && plan.annualPriceId
      ? plan.annualPriceId
      : plan.priceId

    setLoadingTier(plan.tier)
    try {
      const result = await createCheckoutSession(plan.tier as any, priceId)

      if (result.success && result.data?.url) {
        window.location.href = result.data.url
      } else {
        toast.error('Failed to start checkout', {
          description: result.error || 'Please try again',
        })
      }
    } catch (error: any) {
      toast.error('Error', {
        description: error.message || 'Failed to start checkout',
      })
    } finally {
      setLoadingTier(null)
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/settings/billing"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Billing
        </Link>
        <h1 className="text-3xl font-bold">Upgrade Your Plan</h1>
        <p className="text-muted-foreground mt-1">
          Choose the plan that fits your team. Cancel anytime.
        </p>
      </div>

      {/* Billing Toggle */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center bg-muted rounded-lg p-1">
          {(['monthly', 'annual'] as const).map(period => (
            <button
              key={period}
              onClick={() => setBilling(period)}
              className={`px-6 py-2 rounded-md text-sm font-medium transition-all ${
                billing === period
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {period === 'monthly' ? 'Monthly' : 'Annual'}
              {period === 'annual' && (
                <span className="ml-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">
                  Save 20%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {plans.map(plan => {
          const price = billing === 'annual' && plan.annualPrice
            ? plan.annualPrice
            : plan.price
          const isLoading = loadingTier === plan.tier

          return (
            <div
              key={plan.tier}
              className={`relative rounded-2xl border p-6 flex flex-col ${
                plan.popular
                  ? 'border-primary shadow-lg shadow-primary/10'
                  : 'border-border'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-4 py-1 rounded-full whitespace-nowrap">
                  Most Popular
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
                <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                {plan.tier === 'enterprise' ? (
                  <div className="text-3xl font-bold">Custom</div>
                ) : (
                  <div>
                    <div className="flex items-end gap-1">
                      <span className="text-3xl font-bold">${price}</span>
                      <span className="text-muted-foreground mb-1">/month</span>
                    </div>
                    {billing === 'annual' && plan.annualPrice && (
                      <p className="text-xs text-green-600 font-medium mt-1">
                        Save ${(plan.price - plan.annualPrice) * 12}/year
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 flex-1 mb-6">
                {plan.features.map(feature => (
                  <div key={feature} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => handleUpgrade(plan)}
                disabled={isLoading}
                className={`w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all ${
                  plan.popular
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md'
                    : 'border border-primary text-primary hover:bg-primary/5'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Zap className="h-4 w-4 animate-spin" />
                    Starting checkout...
                  </span>
                ) : plan.tier === 'enterprise' ? (
                  'Contact Sales'
                ) : (
                  'Upgrade Now'
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Trust signals */}
      <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
        {[
          '14-day money-back guarantee',
          'Cancel anytime',
          'No hidden fees',
          'Instant access',
        ].map(item => (
          <div key={item} className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}
