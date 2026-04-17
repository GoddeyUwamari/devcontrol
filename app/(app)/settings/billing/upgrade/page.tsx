'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, Zap, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { createCheckoutSession, getSubscription, openCustomerPortal } from '@/lib/services/stripe.service'
import Link from 'next/link'

const plans = [
  {
    name: 'Cost Control',
    tier: 'starter',
    price: 49,
    annualPrice: 63,
    priceId: 'price_1TJBsAHTCYC33EIRTp9R4IMh',
    annualPriceId: 'price_1TJBwMHTCYC33EIR9RdjFpGW',
    description: 'Identify and eliminate the most common sources of AWS waste.',
    features: [
      'Up to 60 AWS resources',
      '15 resource types',
      'Idle & orphaned resource detection',
      'Cost attribution by team',
      'Actionable savings recommendations',
      'Infrastructure monitoring',
      'Active alerts & alert history',
      'Export reports (CSV/PDF)',
      'Up to 5 team members',
      'Email support',
    ],
  },
  {
    name: 'Optimization Engine',
    tier: 'pro',
    price: 199,
    annualPrice: 239,
    priceId: 'price_1TJC3AHTCYC33EIRjY1RN0I6',
    annualPriceId: 'price_1TJC4DHTCYC33EIRbANhi4iF',
    popular: true,
    description: 'Turn your AWS into a predictable, optimized system.',
    features: [
      '✨ AI Chat Assistant (unlimited queries)',
      '✨ Anomaly Detection (4 detection types)',
      '✨ Natural Language Search',
      '✨ AI Cost Optimization (8 types)',
      '✨ On-Demand AI Reports',
      '✨ Smart AI Recommendations',
      'Up to 500 AWS resources',
      'Compliance scanning (SOC 2, HIPAA)',
      'Risk score & trends',
      'SLO Dashboard',
      'DORA metrics & engineering performance',
      'Slack & Jira integrations',
      'Webhook integrations (5 endpoints)',
      'Up to 10 team members',
      'Priority support',
    ],
  },
  {
    name: 'Revenue Protection',
    tier: 'enterprise',
    price: 999,
    priceId: 'price_1Skm4iH8pNFfrvRPa6nDnjqc',
    description: 'Protect revenue at scale and eliminate high-impact risk.',
    features: [
      '✨ Everything in Optimization Engine',
      '✨ Scheduled AI Reports (weekly/monthly)',
      '✨ Weekly AI Email Summaries',
      '✨ Custom Anomaly Detection Rules',
      '✨ Advanced AI Insights',
      'Unlimited AWS resources',
      'Custom compliance frameworks',
      'SOC 2 & HIPAA named-control audit reports',
      'Auto-remediation workflows',
      'Advanced SLO management',
      'Multi-account monitoring',
      'SSO/SAML authentication',
      'Dedicated account manager',
      '24/7 priority support',
    ],
  },
]

const tierOrder: Record<string, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 }

export default function UpgradePage() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly')
  const [loadingTier, setLoadingTier] = useState<string | null>(null)
  const [currentTier, setCurrentTier] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)

  useEffect(() => {
    getSubscription().then(result => {
      setCurrentTier(result.success && result.data ? result.data.tier : 'free')
    })
  }, [])

  const subscriptionLoaded = currentTier !== null
  const resolvedTier = currentTier ?? 'free'
  const canDowngrade = subscriptionLoaded && tierOrder[resolvedTier] > 1

  const handleDowngrade = async () => {
    setPortalLoading(true)
    toast.info('Opening billing portal', {
      description: 'Plan changes take effect at the start of your next billing cycle.',
    })
    try {
      const result = await openCustomerPortal()
      if (result.success && result.data?.url) {
        window.location.href = result.data.url
      } else {
        toast.error('Failed to open portal', { description: result.error || 'Please try again' })
      }
    } catch (error: any) {
      toast.error('Error', { description: error.message || 'Failed to open portal' })
    } finally {
      setPortalLoading(false)
    }
  }

  const handleUpgrade = async (plan: typeof plans[0]) => {
    const priceId = billing === 'annual' && plan.annualPriceId
      ? plan.annualPriceId
      : plan.priceId
    setLoadingTier(plan.tier)
    try {
      const result = await createCheckoutSession(plan.tier as any, priceId)
      if (result.success && result.data?.url) {
        window.location.href = result.data.url
      } else {
        toast.error('Failed to start checkout', { description: result.error || 'Please try again' })
      }
    } catch (error: any) {
      toast.error('Error', { description: error.message || 'Failed to start checkout' })
    } finally {
      setLoadingTier(null)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10">

      {/* Header */}
      <div className="mb-8">
        <Link href="/settings/billing" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-4 w-4" />
          Back to Billing
        </Link>
        <h1 className="text-3xl font-bold">
          {canDowngrade ? 'Change Your Plan' : 'Upgrade Your Plan'}
        </h1>
        <p className="text-muted-foreground mt-1">Choose the plan that fits your team. Cancel anytime.</p>
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
                <span className="ml-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">Save 20%</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
        {!subscriptionLoaded
          ? plans.map(plan => (
              <div key={plan.tier} className="rounded-2xl border border-border p-6 flex flex-col gap-4 animate-pulse">
                <div className="h-5 w-24 bg-muted rounded" />
                <div className="h-4 w-full bg-muted rounded" />
                <div className="h-9 w-20 bg-muted rounded" />
                <div className="flex flex-col gap-2 flex-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-4 bg-muted rounded w-4/5" />
                  ))}
                </div>
                <div className="h-11 w-full bg-muted rounded-xl" />
              </div>
            ))
          : plans.map(plan => {
              const isCurrent  = plan.tier === resolvedTier
              const isDowngrade = tierOrder[plan.tier] < tierOrder[resolvedTier]
              const price = billing === 'annual' && plan.annualPrice ? plan.annualPrice : plan.price
              const isLoading = loadingTier === plan.tier
              const showBanner = isCurrent || (!isDowngrade && plan.popular)

              return (
                <div
                  key={plan.tier}
                  className={`rounded-2xl border flex flex-col overflow-hidden ${
                    isCurrent
                      ? 'border-primary/40 bg-primary/5'
                      : isDowngrade
                      ? 'border-dashed border-border opacity-90'
                      : plan.popular
                      ? 'border-primary shadow-lg shadow-primary/10'
                      : 'border-border'
                  }`}
                >
                  {showBanner && (
                    <div style={{ background: '#7C3AED', color: '#fff', borderRadius: '12px 12px 0 0', padding: '6px', textAlign: 'center', fontSize: '12px', fontWeight: 600 }}>
                      {isCurrent ? 'Current Plan' : 'Most Popular'}
                    </div>
                  )}

                  <div className="p-6 flex flex-col flex-1">
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

                    {/* Features */}
                    <div className="flex flex-col gap-2 flex-1 mb-6">
                      {plan.features.map(feature => {
                        const isAI = feature.startsWith('✨')
                        const text = feature.replace('✨ ', '')
                        return (
                          <div key={feature} className="flex items-start gap-2">
                            <CheckCircle2
                              className="h-4 w-4 mt-0.5 shrink-0"
                              style={{ color: isCurrent || isDowngrade ? '#94a3b8' : isAI ? '#7c3aed' : '#16a34a' }}
                            />
                            <span className={`text-sm ${isCurrent || isDowngrade ? 'text-muted-foreground' : isAI ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                              {isAI && !isCurrent && !isDowngrade && (
                                <span className="bg-violet-50 text-violet-700 rounded px-1 py-0.5 text-[10px] font-bold mr-1">AI</span>
                              )}
                              {text}
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    {/* CTA */}
                    {plan.tier === 'enterprise' && !isCurrent ? (
                      <Link href="/contact" target="_blank">
                        <button style={{ width: '100%', padding: '12px', border: '1px solid #E2E8F0', borderRadius: '8px', background: 'white', cursor: 'pointer', fontWeight: 500 }}>
                          Contact Sales
                        </button>
                      </Link>
                    ) : (
                      <button
                        onClick={() => {
                          if (isCurrent) return
                          if (isDowngrade) { handleDowngrade(); return }
                          handleUpgrade(plan)
                        }}
                        disabled={isLoading || portalLoading || isCurrent}
                        className={`w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all ${
                          isCurrent
                            ? 'border border-primary/30 text-primary/50 cursor-default'
                            : isDowngrade
                            ? 'border border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground'
                            : plan.popular
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md'
                            : 'border border-primary text-primary hover:bg-primary/5'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {(isLoading || (isDowngrade && portalLoading)) ? (
                          <span className="flex items-center justify-center gap-2">
                            <Zap className="h-4 w-4 animate-spin" />
                            {isDowngrade ? 'Opening portal...' : 'Starting checkout...'}
                          </span>
                        ) : isCurrent ? (
                          'Current Plan'
                        ) : isDowngrade ? (
                          `Switch to ${plan.name}`
                        ) : (
                          'Upgrade Now'
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })
        }
      </div>

      {canDowngrade && (
        <p className="text-center text-sm text-muted-foreground mb-8">
          Plan changes take effect at the start of your next billing cycle.
        </p>
      )}

      {/* Trust signals */}
      <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
        {['14-day money-back guarantee', 'Cancel anytime', 'No hidden fees', 'Instant access'].map(item => (
          <div key={item} className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            {item}
          </div>
        ))}
      </div>

    </div>
  )
}