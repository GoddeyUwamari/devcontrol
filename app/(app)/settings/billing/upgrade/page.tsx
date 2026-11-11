'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, Zap, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { createCheckoutSession, changePlan, getSubscription } from '@/lib/services/stripe.service'
import { trackLeadQualified } from '@/lib/gtag'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useIsBillingAdmin } from '@/lib/hooks/use-current-role'
import { PLANS, cardFeatures, includesPrevious, priceLabel, annualBillingLine, annualToggleLabel } from '@/lib/plan/plan-catalog'
import { FeatureText } from '@/components/billing/feature-line'
import { InAppTrialLine } from '@/components/billing/trial-line'

// The paid plans, exactly as the pricing page lists them (lib/plan/plan-catalog.ts).
const plans = PLANS.filter(p => p.tier !== 'free').map(p => ({
  name: p.name,
  tier: p.tier,
  popular: !!p.popular,
  description: p.tagline,
  features: cardFeatures(p.tier),
}))

const tierOrder: Record<string, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 }

export default function UpgradePage() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly')
  const [loadingTier, setLoadingTier] = useState<string | null>(null)
  const [currentTier, setCurrentTier] = useState<string | null>(null)
  // From the server's billing summary: whether a plan change modifies the
  // recorded subscription or starts Checkout, and whether the free trial is
  // offered now. Never inferred from the tier here.
  const [selfServe, setSelfServe] = useState<'checkout' | 'change_plan' | 'none'>('checkout')
  const [trialEligible, setTrialEligible] = useState(false)
  const router = useRouter()
  // changePlan (modifying an *existing* subscription) is owner/admin-only
  // server-side (StripeController.requireBillingAdmin); createCheckoutSession
  // (starting a brand-new subscription from free tier) is not role-gated at
  // all -- any authenticated member may do that. Gating below mirrors this
  // exactly: only the changePlan path (hasExistingSubscription) is blocked
  // for non-admins.
  const isBillingAdmin = useIsBillingAdmin()

  useEffect(() => {
    getSubscription().then(result => {
      setCurrentTier(result.success && result.data ? result.data.tier : 'free')
      if (result.success && result.data?.actions) setSelfServe(result.data.actions.selfServe)
      setTrialEligible(result.success && result.data?.trial?.eligible === true)
    })
  }, [])

  const subscriptionLoaded = currentTier !== null
  const resolvedTier = currentTier ?? 'free'
  const canDowngrade = subscriptionLoaded && tierOrder[resolvedTier] > 1
  // An organization with a billable subscription changes it in place
  // (upgrade or downgrade); Checkout again would start a second one. The
  // server decides which (actions.selfServe).
  const hasExistingSubscription = subscriptionLoaded && selfServe === 'change_plan'

  const handlePlanChange = async (plan: typeof plans[0]) => {
    setLoadingTier(plan.tier)
    try {
      if (hasExistingSubscription) {
        const result = await changePlan(plan.tier as any, billing)
        if (result.success) {
          toast.success('Plan updated', {
            description: `You're now on the ${plan.name} plan. A prorated charge or credit will appear on your next invoice.`,
          })
          router.push('/settings/billing')
        } else {
          toast.error('Failed to change plan', { description: result.error || 'Please try again' })
        }
      } else {
        const result = await createCheckoutSession(plan.tier as any, billing)
        if (result.success && result.data?.url) {
          window.location.href = result.data.url
        } else {
          toast.error('Failed to start checkout', { description: result.error || 'Please try again' })
        }
      }
    } catch (error: any) {
      toast.error('Error', { description: error.message || 'Failed to update plan' })
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
                <span className="ml-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">{annualToggleLabel()}</span>
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
              const billingLine = billing === 'annual' ? annualBillingLine(plan.tier) : null
              const previous = includesPrevious(plan.tier)
              const isLoading = loadingTier === plan.tier
              const showBanner = isCurrent || (!isDowngrade && plan.popular)
              // Only a plan CHANGE (an org already on a paid tier) hits
              // changePlan, which is owner/admin-only server-side. Starting
              // a brand-new subscription from free tier (createCheckoutSession)
              // has no role gate at all, so it stays open to every role.
              const blockedByRole = hasExistingSubscription && !isBillingAdmin

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
                        <div className="text-3xl font-bold">{priceLabel(plan.tier, billing)}</div>
                      ) : (
                        <div>
                          <div className="flex items-end gap-1">
                            <span className="text-3xl font-bold">{priceLabel(plan.tier, billing)}</span>
                            <span className="text-muted-foreground mb-1">/month</span>
                          </div>
                          {billingLine && (
                            <p className="text-xs text-green-600 font-medium mt-1">
                              {billingLine}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Features */}
                    <div className="flex flex-col gap-2 flex-1 mb-6">
                      {previous && (
                        <p className="text-xs text-muted-foreground font-semibold">Everything in {previous}, plus:</p>
                      )}
                      {plan.features.map(feature => {
                        const isAI = !!feature.ai
                        const muted = isCurrent || isDowngrade
                        return (
                          <div key={feature.id} className="flex items-start gap-2">
                            <CheckCircle2
                              className="h-4 w-4 mt-0.5 shrink-0"
                              style={{ color: muted || feature.badge === 'Coming soon' ? '#94a3b8' : isAI ? '#7c3aed' : '#16a34a' }}
                            />
                            <span className={`text-sm ${muted ? 'text-muted-foreground' : isAI ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                              <FeatureText feature={feature} aiChip={!muted} />
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
                          trackLeadQualified(plan.name)
                          if (isCurrent || blockedByRole) return
                          handlePlanChange(plan)
                        }}
                        disabled={isLoading || isCurrent || blockedByRole}
                        title={blockedByRole ? 'Only organization owners and admins can change the plan' : undefined}
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
                        {isLoading ? (
                          <span className="flex items-center justify-center gap-2">
                            <Zap className="h-4 w-4 animate-spin" />
                            {hasExistingSubscription ? 'Updating plan...' : 'Starting checkout...'}
                          </span>
                        ) : isCurrent ? (
                          'Current Plan'
                        ) : blockedByRole ? (
                          'Owner/admin required'
                        ) : isDowngrade ? (
                          `Switch to ${plan.name}`
                        ) : (
                          'Upgrade Now'
                        )}
                      </button>
                    )}
                    <InAppTrialLine
                      eligible={trialEligible && !hasExistingSubscription && (plan.tier === 'starter' || plan.tier === 'pro')}
                      className="text-xs text-muted-foreground mt-2 text-center"
                    />
                  </div>
                </div>
              )
            })
        }
      </div>

      {canDowngrade && (
        <p className="text-center text-sm text-muted-foreground mb-8">
          Plan changes take effect immediately, with a prorated charge or credit applied to your next invoice.
        </p>
      )}

      {/* Trust signals */}
      <div className="flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
        {['Refund review within 14 days of a charge', 'Cancel anytime', 'No hidden fees', 'Instant access'].map(item => (
          <div key={item} className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            {item}
          </div>
        ))}
      </div>

    </div>
  )
}