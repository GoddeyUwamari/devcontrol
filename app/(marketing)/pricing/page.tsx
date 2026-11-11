'use client'

import { useState } from 'react'
import { CheckCircle2, Clock, Shield, Sparkles } from 'lucide-react'
import { FeatureComparisonTable } from '@/components/billing/feature-comparison-table'
import { PricingFAQ } from '@/components/billing/pricing-faq'
import { TrialCta, TrialLine } from '@/components/billing/trial-line'
import { FeatureText } from '@/components/billing/feature-line'
import {
  PLANS, cardFeatures, includesPrevious, priceLabel, annualBillingLine, annualToggleLabel, plan,
  FOUNDING_OFFER_VISIBLE,
} from '@/lib/plan/plan-catalog'
import type { Tier } from '@/lib/plan/plan-names'
import { FoundingBanner } from '@/components/billing/founding-banner'

/** Card buttons that are not a sign-up (the trial-aware button covers the paid self-serve plans). */
const CARD_CTA: Partial<Record<Tier, { label: string; href: string }>> = {
  free: { label: 'Scan My AWS for Free', href: '/register' },
  enterprise: { label: 'Schedule a Cost Audit', href: '/contact' },
}

function ROICalculator() {
  const [spend, setSpend] = useState(10000)
  const pro = plan('pro')
  const proPrice = pro.monthly ?? 0
  const wasteLow  = Math.round(spend * 0.20)
  const wasteHigh = Math.round(spend * 0.40)
  const savings   = Math.round(spend * 0.24)
  const annual    = savings * 12
  const roi       = Math.round(savings / proPrice)
  const barPct    = Math.min(99, Math.round((savings / (savings + proPrice)) * 100))
  const fmt       = (n: number) => '$' + n.toLocaleString()

  return (
    <section className="w-full bg-white px-4 py-12 sm:px-6 sm:py-16 lg:px-12 lg:py-20">
      <div className="max-w-[1400px] mx-auto">
        <div className="text-center mb-12">
          <div className="text-[11px] font-bold text-violet-700 uppercase tracking-widest mb-3">ROI Calculator</div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-indigo-950 tracking-tight mb-3">
            How Much Could Typical AWS Waste Cost You?
          </h2>
          <p className="text-base text-gray-700 max-w-lg mx-auto leading-relaxed">
            Move the slider to your monthly AWS spend. This is an industry-average illustration, not an analysis of your AWS account — connect AWS to get your own numbers.
          </p>
        </div>

        <div className="bg-white border-2 border-gray-200 rounded-2xl p-6 sm:p-12 shadow-sm">
          <div className="mb-10">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-sm text-gray-700 font-medium">Monthly AWS spend</span>
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-900">{fmt(spend)}</span>
            </div>
            <input
              type="range" min="1000" max="100000" step="1000"
              value={spend}
              onChange={e => setSpend(Number(e.target.value))}
              className="w-full cursor-pointer accent-violet-700"
            />
            <div className="flex justify-between mt-1.5 text-xs text-gray-400">
              <span>$1K</span><span>$25K</span><span>$50K</span><span>$100K</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {[
              { label: 'Typical waste range', value: `${fmt(wasteLow)}–${fmt(wasteHigh)}`, sub: 'Industry avg., 20–40% of spend', color: 'text-red-600'    },
              { label: 'Illustrative savings', value: `${fmt(savings)}/mo`,                sub: `${fmt(annual)}/year, industry avg.`, color: 'text-emerald-600' },
              { label: 'Hypothetical ROI',     value: `${roi}x`,                           sub: `vs. ${fmt(proPrice)}/mo ${pro.name} plan`,   color: 'text-violet-700'  },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="bg-gray-50 rounded-xl p-4 sm:p-5 border border-gray-100">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
                <p className={`text-xl sm:text-2xl font-extrabold leading-none mb-1 ${color}`}>{value}</p>
                <p className="text-xs text-gray-400">{sub}</p>
              </div>
            ))}
          </div>

          <div className="mb-8">
            <div className="flex justify-between text-xs text-slate-500 mb-1.5">
              <span>Illustrative savings vs DevControl cost</span>
              <span>{fmt(savings)} vs {fmt(proPrice)} cost</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${barPct}%`, background: 'linear-gradient(90deg, #7c3aed, #059669)' }} />
            </div>
          </div>

          <a href="/register" className="block text-center bg-violet-700 hover:bg-violet-800 text-white py-4 px-8 rounded-xl font-bold text-base no-underline shadow-lg shadow-violet-200 mb-3 transition-colors">
            Connect your AWS account — free
          </a>
          <p className="text-center text-xs text-gray-400">
            Figures above are an industry-average illustration, not a DevControl-specific estimate of your account · Read-only AWS access · Free Visibility plan
          </p>
        </div>

        {/* Competitive comparison */}
        <div className="mt-12 border-2 border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-7 sm:px-8 border-b border-gray-100">
            <p className="text-[11px] font-bold text-violet-700 uppercase tracking-widest mb-2.5">Competitive positioning</p>
            <h3 className="text-xl font-extrabold text-slate-900 mb-1.5">Why not just use AWS Cost Explorer?</h3>
            <p className="text-sm text-gray-700 leading-relaxed">
              Cost Explorer shows what you spent. DevControl shows exactly what to fix — and how much you will save doing it.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <div className="p-5 sm:p-7">
              <div className="flex items-center gap-2 mb-5">
                <span className="text-sm font-bold text-slate-900">AWS Cost Explorer</span>
                <span className="text-[11px] font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Free</span>
              </div>
              <div className="flex flex-col gap-3">
                {[
                  'Shows historical spend — no context on what caused it',
                  'No checks for unattached volumes or unused Elastic IPs',
                  'Requires hours of manual engineering analysis',
                  'No security posture or compliance scanning',
                ].map(text => (
                  <div key={text} className="flex gap-2 items-start">
                    <span className="text-red-600 font-bold shrink-0 mt-0.5">✗</span>
                    <span className="text-sm text-gray-700 leading-relaxed">{text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-5 sm:p-7 bg-violet-50 border-t sm:border-t-0 sm:border-l border-gray-100">
              <div className="flex items-center gap-2 mb-5">
                <span className="text-sm font-bold text-slate-900">DevControl</span>
                <span className="text-[11px] font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">Free plan · paid plans from ${plan('starter').monthly}/mo</span>
              </div>
              <div className="flex flex-col gap-3">
                {[
                  'Shows exactly which resources waste money — with fix instructions',
                  'Automated cost checks across EC2, EBS, S3, Lambda and DynamoDB (RDS checks and rightsizing coming soon)',
                  'Automated: results after your first scan',
                  'Security posture, DORA metrics, and compliance in one view',
                  'Anomaly detection on cost and usage — coming soon',
                ].map(text => (
                  <div key={text} className="flex gap-2 items-start">
                    <span className="text-emerald-600 font-bold shrink-0 mt-0.5">✓</span>
                    <span className="text-sm text-gray-700 leading-relaxed">{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="px-5 py-4 sm:px-8 bg-slate-50 border-t border-gray-100 flex items-start gap-2.5">
            <span className="text-violet-700 shrink-0">ℹ</span>
            <p className="text-sm text-gray-700 leading-relaxed">
              <strong>Cost Explorer is a good starting point.</strong> DevControl is what you use when you are serious about eliminating waste — and do not have time to build a FinOps team from scratch.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function PricingPage() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly')

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="w-full bg-gradient-to-br from-violet-50 via-purple-50 to-white px-4 py-12 sm:px-6 sm:py-16 lg:px-12 lg:py-20 text-center border-b border-gray-100">
        <div className="max-w-[1400px] mx-auto">
          <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-full px-4 py-1.5 text-xs font-semibold text-emerald-700 mb-5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Find AWS waste your team is missing
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-indigo-950 leading-tight tracking-tight mb-3">
            Simple Pricing.{' '}
            <span className="text-violet-700">Serious Savings.</span>
          </h1>
          <p className="text-base sm:text-lg text-gray-700 leading-relaxed max-w-lg mx-auto mb-7">
            Start free. Upgrade when you&apos;re ready for deeper cost checks, an AI assistant and DORA metrics.
          </p>
          <div className="flex flex-wrap justify-center items-center gap-3 sm:gap-6 text-xs sm:text-sm font-medium text-gray-700 mb-8">
            {[
              { icon: Clock,        text: 'Results after your first scan' },
              { icon: Shield,       text: 'Read-only AWS access'          },
              { icon: Sparkles,     text: 'Free Visibility plan'          },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-1.5">
                <Icon size={14} className="text-violet-700" />{text}
              </div>
            ))}
            <TrialLine
              variant="chip"
              className="flex items-center gap-1.5"
              icon="zap"
              iconSize={14}
              iconClassName="text-violet-700"
            />
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-violet-700" />SOC 2 Readiness Planned
            </div>
          </div>
          {FOUNDING_OFFER_VISIBLE && <FoundingBanner />}
        </div>
      </section>

      {/* BILLING TOGGLE */}
      <section className="px-4 pt-5 sm:px-6 sm:pt-7 text-center">
        <div className="max-w-[1400px] mx-auto">
          <div className="inline-flex items-center bg-gray-100 rounded-xl p-1">
            {(['monthly', 'annual'] as const).map(period => (
              <button
                key={period}
                onClick={() => setBilling(period)}
                className={`px-6 py-2 rounded-lg text-sm font-semibold border-none cursor-pointer transition-all ${billing === period ? 'bg-violet-700 text-white' : 'bg-transparent text-gray-700'}`}>
                {period === 'monthly' ? 'Monthly' : 'Annual'}
                {period === 'annual' && (
                  <span className="ml-1.5 bg-emerald-600 text-white rounded-full px-1.5 py-0.5 text-[10px] font-bold">{annualToggleLabel()}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING CARDS */}
      <section className="px-4 py-6 sm:px-6 sm:py-8 lg:px-12 lg:py-10 w-full">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {PLANS.map(p => {
            const isPopular    = !!p.popular
            const isEnterprise = p.tier === 'enterprise'
            const previous     = includesPrevious(p.tier)
            const billingLine  = billing === 'annual' ? annualBillingLine(p.tier) : null
            const ctaStyle     = isPopular ? {
              background: '#7c3aed',
              color: '#fff',
              border: 'none',
              boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
            } : {
              background: 'transparent',
              color: '#7c3aed',
              border: '2px solid #7c3aed',
              boxShadow: 'none',
            }
            const ctaClass = 'block text-center py-3 px-6 rounded-xl font-bold text-sm no-underline mb-7 transition-all'
            const plainCta = CARD_CTA[p.tier]

            return (
              <div key={p.tier} data-plan={p.tier} className="bg-white rounded-2xl flex flex-col relative" style={{ border: isPopular ? '2px solid #7c3aed' : '2px solid #e5e7eb', padding: '28px 24px', boxShadow: isPopular ? '0 8px 40px rgba(124,58,237,0.15)' : 'none' }}>
                {isPopular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-violet-700 text-white rounded-full px-4 py-1 text-xs font-bold whitespace-nowrap">
                    Most Popular
                  </div>
                )}
                <div className="text-[11px] font-bold text-violet-700 uppercase tracking-widest mb-2">{p.name}</div>
                <p className="text-xs text-slate-500 leading-relaxed mb-3">{p.tagline}</p>
                <div className="mb-6">
                  {isEnterprise ? (
                    <div className="text-3xl font-extrabold text-slate-900">{priceLabel(p.tier, billing)}</div>
                  ) : (
                    <div className="flex items-end gap-1">
                      <span className="text-4xl font-extrabold text-slate-900 leading-none">{priceLabel(p.tier, billing)}</span>
                      <span className="text-sm text-gray-500 mb-1">/month</span>
                    </div>
                  )}
                  {billingLine && (
                    <div className="text-xs text-emerald-600 font-semibold mt-1">{billingLine}</div>
                  )}
                  {p.priceNote && <div className="text-xs text-gray-500 mt-1">{p.priceNote}</div>}
                </div>

                {plainCta ? (
                  <a href={plainCta.href} className={ctaClass} style={ctaStyle}>{plainCta.label}</a>
                ) : (
                  <TrialCta plan={p.tier} className={ctaClass} style={ctaStyle} />
                )}

                <div className="border-t border-gray-100 mb-6" />
                {previous && (
                  <p className="text-xs text-slate-500 font-semibold mb-3">
                    Everything in {previous}, plus:
                  </p>
                )}
                <div className="flex flex-col gap-2.5 flex-1">
                  {cardFeatures(p.tier).map(f => (
                    <div key={f.id} className="flex items-start gap-2.5">
                      <CheckCircle2 size={15} className="shrink-0 mt-0.5" style={{ color: f.badge === 'Coming soon' ? '#9ca3af' : f.ai ? '#7c3aed' : '#16a34a' }} />
                      <span className={`text-sm text-gray-700 ${f.ai ? 'font-semibold' : ''}`}>
                        <FeatureText feature={f} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="max-w-[1400px] mx-auto mt-8 text-center">
          <p className="text-sm text-gray-700 font-medium mb-3">
            Refund review within 14 days of a charge
          </p>
          <div className="flex flex-wrap justify-center gap-3 sm:gap-5 text-xs text-gray-500">
            {['Cancel anytime', 'No hidden fees', 'Instant access', 'SOC 2 Readiness Planned'].map(item => (
              <span key={item} className="flex items-center gap-1">
                <CheckCircle2 size={12} className="text-emerald-600" />{item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ROI CALCULATOR */}
      <ROICalculator />

      {/* FEATURE COMPARISON */}
      <section className="px-4 py-8 sm:px-6 sm:py-10 lg:px-12 lg:py-16 w-full bg-gray-50">
        <div className="max-w-[1400px] mx-auto">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-indigo-950 text-center mb-8 sm:mb-12 tracking-tight">
            Compare Plans
          </h2>
          <FeatureComparisonTable />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-4 py-10 sm:px-6 sm:py-12 lg:px-12 lg:py-16 w-full">
        <div className="max-w-[1400px] mx-auto">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-indigo-950 text-center mb-8 sm:mb-12 tracking-tight">
            Frequently Asked Questions
          </h2>
          <PricingFAQ />
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="w-full bg-gradient-to-br from-violet-700 to-violet-900 px-4 py-12 sm:px-6 sm:py-16 lg:px-12 lg:py-20 text-center">
        <div className="max-w-[1400px] mx-auto">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white mb-4 tracking-tight">
            Ready to Optimize Your AWS Costs?
          </h2>
          <p className="text-base sm:text-lg text-white/85 max-w-md mx-auto mb-8 leading-relaxed">
            Connect your AWS account and see what DevControl finds on the free Visibility plan.
            <TrialLine variant="sentence" prefix=" " suffix="." />
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 flex-wrap">
            <TrialCta className="w-full sm:w-auto text-center bg-white text-violet-700 px-8 py-3.5 rounded-xl font-bold text-base no-underline" />
            <a href="/contact" className="w-full sm:w-auto text-center bg-transparent text-white border-2 border-white/40 px-8 py-3.5 rounded-xl font-semibold text-base no-underline">
              Schedule Demo
            </a>
          </div>
          <TrialLine variant="trust" rest={['Cancel anytime']} className="block text-xs text-white/60 mt-4" />
        </div>
      </section>

    </div>
  )
}
