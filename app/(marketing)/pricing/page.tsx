'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, Clock, Shield, Sparkles, Zap } from 'lucide-react'
import { FeatureComparisonTable } from '@/components/billing/feature-comparison-table'
import { PricingFAQ } from '@/components/billing/pricing-faq'
import { PricingTier } from '@/types/billing'

const pricingTiers: PricingTier[] = [
  {
    name: 'Visibility',
    tagline: 'See where your AWS money is going — in minutes.',
    tier: 'free',
    price: 0,
    priceId: 'free',
    trialDays: 0,
    features: [
      'Up to 20 AWS resources',
      '3 resource types (EC2, RDS, S3)',
      'Basic cost visibility',
      'Email alerts',
      'Status page access',
      'Support: Community',
    ],
    limits: { resources: 20, resourceTypes: 3, apiRequests: 500, teamMembers: 1 },
    cta: 'Scan My AWS for Free',
  },
  {
    name: 'Cost Control',
    tagline: 'Identify and eliminate the most common sources of AWS waste.',
    tier: 'starter',
    price: 49,
    priceId: 'price_1TJBsAHTCYC33EIRTp9R4IMh',
    annualPrice: 63,
    annualPriceId: 'price_1TJBwMHTCYC33EIR9RdjFpGW',
    annualSavings: 192,
    trialDays: 14,
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
      'Support: Email',
      '💡 Typically uncovers $1K–$5K/month in savings',
    ],
    limits: { resources: 60, resourceTypes: 10, apiRequests: 2000, teamMembers: 5 },
    cta: 'Find My Hidden Costs',
  },
  {
    name: 'Optimization Engine',
    tagline: 'Turn your AWS into a predictable, optimized system.',
    tier: 'pro',
    price: 199,
    priceId: 'price_1TJC3AHTCYC33EIRjY1RN0I6',
    annualPrice: 239,
    annualPriceId: 'price_1TJC4DHTCYC33EIRbANhi4iF',
    annualSavings: 720,
    popular: true,
    trialDays: 14,
    features: [
      '✨ AI Chat Assistant (unlimited queries)',
      '✨ Anomaly Detection (4 detection types)',
      '✨ Natural Language Search',
      '✨ AI Cost Optimization (8 types)',
      '✨ On-Demand AI Reports',
      '✨ Smart AI Recommendations',
      '───────────────',
      'Up to 500 AWS resources',
      'Compliance scanning (SOC 2, HIPAA)',
      'Risk score & trends',
      'SLO Dashboard',
      'DORA metrics & engineering performance',
      'Slack & Jira integrations',
      'Webhook integrations (5 endpoints)',
      'Up to 10 team members',
      'Support: Priority email',
      '💡 Pays for itself with just a 5% cost reduction',
      '💡 Used by teams spending $10K–$100K/month on AWS',
    ],
    limits: { resources: 500, resourceTypes: 'all', apiRequests: 5000, teamMembers: 10 },
    cta: 'Unlock Full Cost Control',
  },
  {
    name: 'Revenue Protection',
    tagline: 'Protect revenue at scale and eliminate high-impact risk.',
    tier: 'enterprise',
    price: 999,
    priceId: 'price_1Skm4iH8pNFfrvRPa6nDnjqc',
    trialDays: 0,
    features: [
      '✨ Everything in Optimization Engine',
      '✨ Scheduled AI Reports (weekly/monthly)',
      '✨ Weekly AI Email Summaries',
      '✨ Custom Anomaly Detection Rules',
      '✨ Advanced AI Insights',
      '───────────────',
      'Unlimited AWS resources',
      'Custom compliance frameworks',
      'SOC 2 & HIPAA named-control audit reports',
      'Auto-remediation workflows',
      'Advanced SLO management',
      'Multi-account monitoring',
      'SSO/SAML authentication',
      'Support: Dedicated',
      '💡 For teams where a single incident can cost $10K+',
    ],
    limits: { resources: 'unlimited', resourceTypes: 'all', apiRequests: 20000, teamMembers: 'Unlimited' },
    cta: 'Schedule a Cost Audit',
    addOns: [
      { name: 'Additional API requests', price: 99 },
      { name: 'Custom integrations', price: 299 },
    ],
  },
]

function ROICalculator() {
  const [spend, setSpend] = useState(10000)
  const wasteLow  = Math.round(spend * 0.20)
  const wasteHigh = Math.round(spend * 0.40)
  const savings   = Math.round(spend * 0.24)
  const annual    = savings * 12
  const roi       = Math.round(savings / 199)
  const barPct    = Math.min(99, Math.round((savings / (savings + 199)) * 100))
  const fmt       = (n: number) => '$' + n.toLocaleString()

  return (
    <section className="w-full bg-white px-4 py-12 sm:px-6 sm:py-16 lg:px-12 lg:py-20">
      <div className="max-w-[1400px] mx-auto">
        <div className="text-center mb-12">
          <div className="text-[11px] font-bold text-violet-700 uppercase tracking-widest mb-3">ROI Calculator</div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 tracking-tight mb-3">
            How Much AWS Spend Are You Wasting?
          </h2>
          <p className="text-base text-gray-700 max-w-lg mx-auto leading-relaxed">
            Move the slider to your monthly AWS spend. See what is likely leaking — and what you could recover.
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
              { label: 'Estimated waste',     value: `${fmt(wasteLow)}–${fmt(wasteHigh)}`, sub: '20–40% of AWS spend', color: 'text-red-600'    },
              { label: 'Recoverable savings',  value: `${fmt(savings)}/mo`,                sub: `${fmt(annual)}/year`, color: 'text-emerald-600' },
              { label: 'DevControl ROI',       value: `${roi}x`,                           sub: '$199/mo Pro plan',   color: 'text-violet-700'  },
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
              <span>Savings vs DevControl cost</span>
              <span>{fmt(savings)} savings vs $199 cost</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${barPct}%`, background: 'linear-gradient(90deg, #7c3aed, #059669)' }} />
            </div>
          </div>

          <a href="/register" className="block text-center bg-violet-700 hover:bg-violet-800 text-white py-4 px-8 rounded-xl font-bold text-base no-underline shadow-lg shadow-violet-200 mb-3 transition-colors">
            {`Reveal my ${fmt(savings)}/mo in savings — free`}
          </a>
          <p className="text-center text-xs text-gray-400">
            2-minute setup · Read-only AWS access · No credit card required
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
                  'No idle resource detection or rightsizing',
                  'Requires hours of manual engineering analysis',
                  'No security posture or compliance scanning',
                  'No proactive anomaly detection or spike alerts',
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
                <span className="text-[11px] font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">From $199/mo</span>
              </div>
              <div className="flex flex-col gap-3">
                {[
                  'Shows exactly which resources waste money — with fix instructions',
                  'AI-powered rightsizing and idle detection across 50+ resource types',
                  'Fully automated — first insights in 15 minutes',
                  'Security posture, DORA metrics, and compliance in one view',
                  'Real-time anomaly detection before month-end surprises',
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
  const [foundingCount, setFoundingCount] = useState(5)

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/organizations/founding-count`)
      .then(res => res.json())
      .then(data => setFoundingCount(data.count ?? 5))
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="w-full bg-gradient-to-br from-violet-50 via-purple-50 to-white px-4 py-12 sm:px-6 sm:py-16 lg:px-12 lg:py-20 text-center border-b border-gray-100">
        <div className="max-w-[1400px] mx-auto">
          <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-full px-4 py-1.5 text-xs font-semibold text-emerald-700 mb-5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Teams save an average of $2,400/month · $28,800/year
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 leading-tight tracking-tight mb-3">
            Simple Pricing.{' '}
            <span className="text-violet-700">Serious Savings.</span>
          </h1>
          <p className="text-base sm:text-lg text-gray-700 leading-relaxed max-w-lg mx-auto mb-7">
            Start free. Upgrade when you are ready for AI-powered cost optimization, security scanning, and DORA metrics.{' '}
            <strong className="text-slate-900">Average ROI on Pro: 8x within 30 days.</strong>
          </p>
          <div className="flex flex-wrap justify-center items-center gap-3 sm:gap-6 text-xs sm:text-sm font-medium text-gray-700 mb-8">
            {[
              { icon: Clock,        text: 'First leak found in 15 min' },
              { icon: Shield,       text: 'Read-only AWS access'        },
              { icon: Sparkles,     text: 'No credit card required'     },
              { icon: Zap,          text: '14-day free trial'           },
              { icon: CheckCircle2, text: 'SOC 2 In Progress'           },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-1.5">
                <Icon size={14} className="text-violet-700" />{text}
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-violet-50 border border-violet-200 rounded-2xl px-4 py-4 sm:px-6 max-w-2xl mx-auto">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-violet-700 flex items-center justify-center shrink-0">
                <Sparkles size={14} className="text-white" />
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-slate-900">Founding Member Pricing — your rate is locked in forever</p>
                <p className="text-xs text-violet-700 mt-0.5">Price increases after the first 50 customers. Founding members never pay more.</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <div>
                <div className="flex gap-1 items-center">
                  {[...Array(10)].map((_, i) => (
                    <div key={i} className="w-2 h-2 rounded-full" style={{ background: i < 5 ? '#7c3aed' : 'rgba(124,58,237,0.2)' }} />
                  ))}
                </div>
                <p className="text-[10px] text-violet-700 font-semibold mt-1 text-center">{foundingCount} of 50 spots claimed</p>
              </div>
              <a href="/register" className="bg-violet-700 text-white px-4 py-2 rounded-lg font-bold text-xs no-underline whitespace-nowrap">
                Claim founding rate
              </a>
            </div>
          </div>
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
                  <span className="ml-1.5 bg-emerald-600 text-white rounded-full px-1.5 py-0.5 text-[10px] font-bold">Save 20%</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING CARDS */}
      <section className="px-4 py-6 sm:px-6 sm:py-8 lg:px-12 lg:py-10 w-full">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {pricingTiers.map(tier => {
            const isPopular    = tier.popular
            const isEnterprise = tier.tier === 'enterprise'
            const isFree       = tier.tier === 'free'
            const price        = billing === 'annual' && tier.annualPrice ? tier.annualPrice : tier.price

            return (
              <div key={tier.tier} className="bg-white rounded-2xl flex flex-col relative" style={{ border: isPopular ? '2px solid #7c3aed' : '2px solid #e5e7eb', padding: '28px 24px', boxShadow: isPopular ? '0 8px 40px rgba(124,58,237,0.15)' : 'none' }}>
                {isPopular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-violet-700 text-white rounded-full px-4 py-1 text-xs font-bold whitespace-nowrap">
                    Most Popular
                  </div>
                )}
                <div className="text-[11px] font-bold text-violet-700 uppercase tracking-widest mb-2">{tier.name}</div>
                {(tier as any).tagline && (
                  <p className="text-xs text-slate-500 leading-relaxed mb-3">{(tier as any).tagline}</p>
                )}
                <div className="mb-6">
                  {isEnterprise ? (
                    <div className="text-3xl font-extrabold text-slate-900">Custom</div>
                  ) : (
                    <div className="flex items-end gap-1">
                      <span className="text-4xl font-extrabold text-slate-900 leading-none">${price}</span>
                      <span className="text-sm text-gray-500 mb-1">/month</span>
                    </div>
                  )}
                  {billing === 'annual' && tier.annualSavings && (
                    <div className="text-xs text-emerald-600 font-semibold mt-1">Save ${tier.annualSavings}/year</div>
                  )}
                  {isFree && <div className="text-xs text-gray-500 mt-1">Free forever</div>}
                </div>
  
                <a
                  href={isEnterprise ? '/contact' : '/register'}
                  className="block text-center py-3 px-6 rounded-xl font-bold text-sm no-underline mb-7 transition-all"
                  style={isPopular ? {
                    background: '#7c3aed',
                    color: '#fff',
                    border: 'none',
                    boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
                  } : {
                    background: 'transparent',
                    color: '#7c3aed',
                    border: '2px solid #7c3aed',
                    boxShadow: 'none',
                  }}
                >
                  {tier.cta}
                </a>
              

                <div className="border-t border-gray-100 mb-6" />
                <div className="flex flex-col gap-2.5 flex-1">
                  {tier.features
                    .filter(f => !f.startsWith('───'))
                    .map(feature => {
                      const isAI      = feature.startsWith('✨')
                      const isInsight = feature.startsWith('💡')
                      const text      = feature.replace('✨ ', '').replace('💡 ', '')
                      if (isInsight) {
                        return (
                          <div key={feature} className="flex items-start gap-1.5 pt-1 text-emerald-700 text-xs font-semibold italic">
                            <span className="shrink-0">💡</span><span>{text}</span>
                          </div>
                        )
                      }
                      return (
                        <div key={feature} className="flex items-start gap-2.5">
                          <CheckCircle2 size={15} className="shrink-0 mt-0.5" style={{ color: isAI ? '#7c3aed' : '#16a34a' }} />
                          <span className={`text-sm text-gray-700 ${isAI ? 'font-semibold' : ''}`}>
                            {isAI && <span className="bg-violet-50 text-violet-700 rounded px-1 py-0.5 text-[10px] font-bold mr-1">AI</span>}
                            {text}
                          </span>
                        </div>
                      )
                    })}
                </div>
              </div>
            )
          })}
        </div>
        <div className="max-w-[1400px] mx-auto mt-8 text-center">
          <p className="text-sm text-gray-700 font-medium mb-3">
            All paid plans include a <strong>14-day money-back guarantee</strong>
          </p>
          <div className="flex flex-wrap justify-center gap-3 sm:gap-5 text-xs text-gray-500">
            {['Cancel anytime', 'No hidden fees', 'Instant access', 'SOC 2 In Progress'].map(item => (
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
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 text-center mb-8 sm:mb-12 tracking-tight">
            Compare Plans
          </h2>
          <FeatureComparisonTable />
        </div>
      </section>

      {/* FAQ */}
      <section className="px-4 py-10 sm:px-6 sm:py-12 lg:px-12 lg:py-16 w-full">
        <div className="max-w-[1400px] mx-auto">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 text-center mb-8 sm:mb-12 tracking-tight">
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
            Join 500+ engineering teams saving an average of $2,400/month with DevControl.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 flex-wrap">
            <a href="/register" className="w-full sm:w-auto text-center bg-white text-violet-700 px-8 py-3.5 rounded-xl font-bold text-base no-underline">
              Start Free 14-Day Trial
            </a>
            <a href="/contact" className="w-full sm:w-auto text-center bg-transparent text-white border-2 border-white/40 px-8 py-3.5 rounded-xl font-semibold text-base no-underline">
              Schedule Demo
            </a>
          </div>
          <p className="text-xs text-white/60 mt-4">No credit card required · 14-day free trial · Cancel anytime</p>
        </div>
      </section>

    </div>
  )
}