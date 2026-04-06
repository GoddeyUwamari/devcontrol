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
    limits: {
      resources: 20,
      resourceTypes: 3,
      apiRequests: 500,
      teamMembers: 1,
    },
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
    limits: {
      resources: 60,
      resourceTypes: 10,
      apiRequests: 2000,
      teamMembers: 5,
    },
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
    limits: {
      resources: 500,
      resourceTypes: 'all',
      apiRequests: 5000,
      teamMembers: 10,
    },
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
    limits: {
      resources: 'unlimited',
      resourceTypes: 'all',
      apiRequests: 20000,
      teamMembers: 'Unlimited',
    },
    cta: 'Schedule a Cost Audit',
    addOns: [
      { name: 'Additional API requests', price: 99 },
      { name: 'Custom integrations', price: 299 },
    ],
  },
]

function ROICalculator() {
  const [spend, setSpend] = useState(10000)

  const wasteLow = Math.round(spend * 0.20)
  const wasteHigh = Math.round(spend * 0.40)
  const savings = Math.round(spend * 0.24)
  const annual = savings * 12
  const roi = Math.round(savings / 199)
  const barPct = Math.min(99, Math.round((savings / (savings + 199)) * 100))
  const fmt = (n: number) => '$' + n.toLocaleString()

  return (
    <section style={{ padding: '80px 48px', width: '100%', background: '#fff' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>

        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <div style={{
            fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed',
            textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
          }}>
            ROI Calculator
          </div>
          <h2 style={{
            fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
            color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '12px',
          }}>
            How Much AWS Spend Are You Wasting?
          </h2>
          <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
            Move the slider to your monthly AWS spend. See what is likely leaking — and what you could recover.
          </p>
        </div>

        <div style={{
          background: '#fff', border: '1.5px solid #e5e7eb',
          borderRadius: '20px', padding: '48px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        }}>
          {/* Slider */}
          <div style={{ marginBottom: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
              <span style={{ fontSize: '0.9rem', color: '#374151', fontWeight: 500 }}>Monthly AWS spend</span>
              <span style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a' }}>{fmt(spend)}</span>
            </div>
            <input
              type="range"
              min="1000"
              max="100000"
              step="1000"
              value={spend}
              onChange={(e) => setSpend(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#7c3aed', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '0.75rem', color: '#9ca3af' }}>
              <span>$1K</span><span>$25K</span><span>$50K</span><span>$100K</span>
            </div>
          </div>

          {/* Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '32px' }}>
            {[
              { label: 'Estimated waste', value: `${fmt(wasteLow)}–${fmt(wasteHigh)}`, sub: '20–40% of AWS spend', color: '#DC2626' },
              { label: 'Recoverable savings', value: `${fmt(savings)}/mo`, sub: `${fmt(annual)}/year`, color: '#059669' },
              { label: 'DevControl ROI', value: `${roi}x`, sub: '$199/mo Pro plan', color: '#7c3aed' },
            ].map(({ label, value, sub, color }) => (
              <div key={label} style={{
                background: '#fafafa', borderRadius: '14px',
                padding: '20px', border: '1px solid #f3f4f6',
              }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>{label}</p>
                <p style={{ fontSize: '1.4rem', fontWeight: 800, color, lineHeight: 1, marginBottom: '4px' }}>{value}</p>
                <p style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{sub}</p>
              </div>
            ))}
          </div>

          {/* Bar */}
          <div style={{ marginBottom: '32px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748B', marginBottom: '6px' }}>
              <span>Savings vs DevControl cost</span>
              <span>{fmt(savings)} savings vs $199 cost</span>
            </div>
            <div style={{ height: '8px', background: '#f3f4f6', borderRadius: '100px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${barPct}%`,
                background: 'linear-gradient(90deg, #7c3aed, #059669)',
                borderRadius: '100px',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>

          {/* CTA */}
          <a href="/register" style={{
            display: 'block', textAlign: 'center',
            background: '#7c3aed', color: '#fff',
            padding: '16px 32px', borderRadius: '12px',
            fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
            boxShadow: '0 4px 20px rgba(124,58,237,0.3)',
            marginBottom: '12px',
          }}>
            {`Reveal my ${fmt(savings)}/mo in savings — free`}
          </a>
          <p style={{ textAlign: 'center', fontSize: '0.78rem', color: '#9ca3af' }}>
            2-minute setup · Read-only AWS access · No credit card required
          </p>
        </div>

        {/* Competitive comparison */}
        <div style={{
          marginTop: '48px',
          border: '1.5px solid #e5e7eb', borderRadius: '20px', overflow: 'hidden',
        }}>
          <div style={{ padding: '28px 32px', borderBottom: '1px solid #f3f4f6' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '10px' }}>
              Competitive positioning
            </p>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
              Why not just use AWS Cost Explorer?
            </h3>
            <p style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6 }}>
              Cost Explorer shows what you spent. DevControl shows exactly what to fix — and how much you will save doing it.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr' }}>
            {/* AWS Cost Explorer */}
            <div style={{ padding: '24px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>AWS Cost Explorer</span>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: '100px' }}>Free</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'Shows historical spend — no context on what caused it',
                  'No idle resource detection or rightsizing',
                  'Requires hours of manual engineering analysis',
                  'No security posture or compliance scanning',
                  'No proactive anomaly detection or spike alerts',
                ].map(text => (
                  <div key={text} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <span style={{ color: '#DC2626', fontWeight: 700, flexShrink: 0, marginTop: '1px' }}>✗</span>
                    <span style={{ fontSize: '0.82rem', color: '#374151', lineHeight: 1.5 }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div style={{ background: '#f3f4f6' }} />

            {/* DevControl */}
            <div style={{ padding: '24px 28px', background: '#faf5ff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>DevControl</span>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, background: 'rgba(124,58,237,0.1)', color: '#7c3aed', padding: '2px 8px', borderRadius: '100px' }}>From $199/mo</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'Shows exactly which resources waste money — with fix instructions',
                  'AI-powered rightsizing and idle detection across 50+ resource types',
                  'Fully automated — first insights in 15 minutes',
                  'Security posture, DORA metrics, and compliance in one view',
                  'Real-time anomaly detection before month-end surprises',
                ].map(text => (
                  <div key={text} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <span style={{ color: '#059669', fontWeight: 700, flexShrink: 0, marginTop: '1px' }}>✓</span>
                    <span style={{ fontSize: '0.82rem', color: '#374151', lineHeight: 1.5 }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{
            padding: '16px 32px', background: '#f8fafc',
            borderTop: '1px solid #f3f4f6',
            display: 'flex', alignItems: 'flex-start', gap: '10px',
          }}>
            <span style={{ color: '#7c3aed', fontSize: '1rem', flexShrink: 0 }}>ℹ</span>
            <p style={{ fontSize: '0.82rem', color: '#374151', lineHeight: 1.6 }}>
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
    fetch('http://localhost:8080/api/organizations/founding-count')
      .then(res => res.json())
      .then(data => setFoundingCount(data.count ?? 5))
      .catch(() => {})
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #fff 100%)',
        padding: '80px 48px 56px',
        textAlign: 'center',
        borderBottom: '1px solid #f3f4f6',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>

          {/* Savings badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)',
            borderRadius: '100px', padding: '5px 16px',
            fontSize: '0.78rem', fontWeight: 600, color: '#15803d',
            marginBottom: '20px',
          }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a' }} />
            Teams save an average of $2,400/month · $28,800/year
          </div>

          <h1 style={{
            fontSize: 'clamp(2rem, 5vw, 3.5rem)',
            fontWeight: 800, color: '#0f172a',
            lineHeight: 1.15, marginBottom: '10px',
            letterSpacing: '-0.02em',
          }}>
            Simple Pricing.{' '}
            <span style={{ color: '#7c3aed' }}>Serious Savings.</span>
          </h1>

          <p style={{
            fontSize: '1.1rem', color: '#374151',
            lineHeight: 1.7, maxWidth: '560px',
            margin: '0 auto 28px',
          }}>
            Start free. Upgrade when you are ready for AI-powered cost optimization,
            security scanning, and DORA metrics.{' '}
            <strong style={{ color: '#0f172a', fontWeight: 700 }}>
              Average ROI on Pro: 8x within 30 days.
            </strong>
          </p>

          {/* Trust signals */}
          <div style={{
            display: 'flex', flexWrap: 'wrap',
            justifyContent: 'center', gap: '24px',
            fontSize: '0.875rem', fontWeight: 500, color: '#374151',
            marginBottom: '32px',
          }}>
            {([
              { icon: Clock,     text: 'First leak found in 15 min' },
              { icon: Shield,    text: 'Read-only AWS access' },
              { icon: Sparkles,  text: 'No credit card required' },
              { icon: Zap,       text: '14-day free trial' },
              { icon: CheckCircle2, text: 'SOC 2 In Progress' },
            ] as const).map(({ icon: Icon, text }) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icon size={15} style={{ color: '#7c3aed' }} />
                {text}
              </div>
            ))}
          </div>

          {/* Founding member banner */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: '16px',
            background: 'rgba(124,58,237,0.06)',
            border: '1px solid rgba(124,58,237,0.2)',
            borderRadius: '14px', padding: '16px 24px',
            maxWidth: '760px', margin: '0 auto',
          }}>
            {/* Left */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%',
                background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Sparkles size={14} style={{ color: '#fff' }} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  Founding Member Pricing — your rate is locked in forever
                </p>
                <p style={{ fontSize: '0.75rem', color: '#7c3aed', margin: '2px 0 0' }}>
                  Price increases after the first 50 customers. Founding members never pay more.
                </p>
              </div>
            </div>

            {/* Right */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {[...Array(10)].map((_, i) => (
                    <div key={i} style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      background: i < 5 ? '#7c3aed' : 'rgba(124,58,237,0.2)',
                    }} />
                  ))}
                </div>
                <p style={{ fontSize: '0.7rem', color: '#7c3aed', fontWeight: 600, marginTop: '4px', textAlign: 'center' }}>
                  {foundingCount} of 50 spots claimed
                </p>
              </div>
              <a href="/register" style={{
                background: '#7c3aed', color: '#fff',
                padding: '8px 16px', borderRadius: '8px',
                fontWeight: 700, fontSize: '0.8rem', textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}>
                Claim founding rate
              </a>
            </div>
          </div>

        </div>
      </section>

      {/* BILLING TOGGLE */}
      <section style={{ padding: '28px 48px 0', textAlign: 'center' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: '#f3f4f6', borderRadius: '10px', padding: '4px',
          }}>
            {(['monthly', 'annual'] as const).map(period => (
              <button
                key={period}
                onClick={() => setBilling(period)}
                style={{
                  padding: '8px 24px', borderRadius: '8px', border: 'none',
                  fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer',
                  background: billing === period ? '#7c3aed' : 'transparent',
                  color: billing === period ? '#fff' : '#374151',
                  transition: 'all 0.2s ease',
                }}
              >
                {period === 'monthly' ? 'Monthly' : 'Annual'}
                {period === 'annual' && (
                  <span style={{
                    marginLeft: '6px', background: '#16a34a', color: '#fff',
                    borderRadius: '100px', padding: '1px 6px', fontSize: '0.65rem',
                    fontWeight: 700,
                  }}>
                    Save 20%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING CARDS */}
      <section style={{ padding: '40px 48px 30px', width: '100%' }}>
        <div style={{
          maxWidth: '1400px', margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '24px',
        }}>
          {pricingTiers.map(tier => {
            const isPopular = tier.popular
            const price = billing === 'annual' && tier.annualPrice
              ? tier.annualPrice
              : tier.price
            const isEnterprise = tier.tier === 'enterprise'
            const isFree = tier.tier === 'free'

            return (
              <div
                key={tier.tier}
                style={{
                  background: '#fff',
                  borderRadius: '20px',
                  border: isPopular ? '2px solid #7c3aed' : '1.5px solid #e5e7eb',
                  padding: '32px',
                  position: 'relative',
                  boxShadow: isPopular
                    ? '0 8px 40px rgba(124,58,237,0.15)'
                    : '0 2px 12px rgba(0,0,0,0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {isPopular && (
                  <div style={{
                    position: 'absolute', top: '-14px', left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#7c3aed', color: '#fff',
                    borderRadius: '100px', padding: '4px 16px',
                    fontSize: '0.75rem', fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}>
                    Most Popular
                  </div>
                )}

                <div style={{
                  fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  marginBottom: '8px',
                }}>
                  {tier.name}
                </div>
                {(tier as any).tagline && (
                  <p style={{
                    fontSize: '0.78rem', color: '#64748b',
                    lineHeight: 1.5, marginBottom: '12px',
                  }}>
                    {(tier as any).tagline}
                  </p>
                )}

                <div style={{ marginBottom: '24px' }}>
                  {isEnterprise ? (
                    <div style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a' }}>
                      Custom
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px' }}>
                      <span style={{ fontSize: '2.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
                        ${price}
                      </span>
                      <span style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '6px' }}>
                        /month
                      </span>
                    </div>
                  )}
                  {billing === 'annual' && tier.annualSavings && (
                    <div style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 600, marginTop: '4px' }}>
                      Save ${tier.annualSavings}/year
                    </div>
                  )}
                  {isFree && (
                    <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '4px' }}>
                      Free forever
                    </div>
                  )}
                </div>

                <a
                  href={isEnterprise ? '/contact' : '/register'}
                  style={{
                    display: 'block', textAlign: 'center',
                    padding: '12px 24px', borderRadius: '10px',
                    fontWeight: 700, fontSize: '0.9rem',
                    textDecoration: 'none', marginBottom: '28px',
                    background: isPopular ? '#7c3aed' : 'transparent',
                    color: isPopular ? '#fff' : '#7c3aed',
                    border: isPopular ? 'none' : '1.5px solid #7c3aed',
                    boxShadow: isPopular ? '0 4px 16px rgba(124,58,237,0.3)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {tier.cta}
                </a>

                <div style={{ borderTop: '1px solid #f3f4f6', marginBottom: '24px' }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                  {tier.features
                    .filter(f => !f.startsWith('───'))
                    .map(feature => {
                      const isAI = feature.startsWith('✨')
                      const isInsight = feature.startsWith('💡')
                      const text = feature.replace('✨ ', '').replace('💡 ', '')
                      if (isInsight) {
                        return (
                          <div key={feature} style={{
                            fontSize: '0.78rem', color: '#059669',
                            fontWeight: 600, fontStyle: 'italic',
                            paddingTop: '4px',
                            display: 'flex', alignItems: 'flex-start', gap: '6px',
                          }}>
                            <span style={{ flexShrink: 0 }}>💡</span>
                            <span>{text}</span>
                          </div>
                        )
                      }
                      return (
                        <div key={feature} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                          <CheckCircle2
                            size={16}
                            style={{ color: isAI ? '#7c3aed' : '#16a34a', marginTop: '2px', flexShrink: 0 }}
                          />
                          <span style={{ fontSize: '0.85rem', color: '#374151', fontWeight: isAI ? 600 : 400 }}>
                            {isAI && (
                              <span style={{
                                background: 'rgba(124,58,237,0.08)',
                                color: '#7c3aed', borderRadius: '4px',
                                padding: '1px 5px', fontSize: '0.65rem',
                                fontWeight: 700, marginRight: '4px',
                              }}>AI</span>
                            )}
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

        <div style={{ maxWidth: '1400px', margin: '32px auto 0', textAlign: 'center' }}>
          <p style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500, marginBottom: '12px' }}>
            All paid plans include a <strong>14-day money-back guarantee</strong>
          </p>
          <div style={{
            display: 'flex', flexWrap: 'wrap',
            justifyContent: 'center', gap: '20px',
            fontSize: '0.8rem', color: '#6b7280',
          }}>
            {['Cancel anytime', 'No hidden fees', 'Instant access', 'SOC 2 In Progress'].map(item => (
              <span key={item} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 size={13} style={{ color: '#16a34a' }} />
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      <ROICalculator />

      {/* FEATURE COMPARISON */}
      <section style={{ padding: '40px 48px 60px', width: '100%', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
            color: '#0f172a', textAlign: 'center',
            marginBottom: '48px', letterSpacing: '-0.02em',
          }}>
            Compare Plans
          </h2>
          <FeatureComparisonTable />
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: '56px 48px 60px', width: '100%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
            color: '#0f172a', textAlign: 'center',
            marginBottom: '48px', letterSpacing: '-0.02em',
          }}>
            Frequently Asked Questions
          </h2>
          <PricingFAQ />
        </div>
      </section>

      {/* FINAL CTA */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
        padding: '80px 48px', textAlign: 'center',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800,
            color: '#fff', marginBottom: '16px', letterSpacing: '-0.02em',
          }}>
            Ready to Optimize Your AWS Costs?
          </h2>
          <p style={{
            fontSize: '1.1rem', color: 'rgba(255,255,255,0.85)',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            Join 500+ engineering teams saving an average of $2,400/month with DevControl.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/register" style={{
              background: '#fff', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
            }}>
              Start Free 14-Day Trial
            </a>
            <a href="/contact" style={{
              background: 'transparent', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.4)',
            }}>
              Schedule Demo
            </a>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginTop: '16px' }}>
            No credit card required · 14-day free trial · Cancel anytime
          </div>
        </div>
      </section>

    </div>
  )
}
