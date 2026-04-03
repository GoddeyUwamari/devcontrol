'use client'

import { useState } from 'react'
import { CheckCircle2, Clock, Shield, Sparkles, Zap } from 'lucide-react'
import { FeatureComparisonTable } from '@/components/billing/feature-comparison-table'
import { PricingFAQ } from '@/components/billing/pricing-faq'
import { PricingROI } from '@/components/pricing/pricing-roi'
import { PricingTier } from '@/types/billing'

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
      'Status page access',
      'Support: Community',
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
    priceId: 'price_1Skm0uH8pNFfrvRPuccIDLoA',
    annualPrice: 63,
    annualPriceId: 'price_starter_annual',
    annualSavings: 192,
    trialDays: 14,
    features: [
      'Up to 60 AWS resources',
      '15 resource types',
      'Cost attribution by team',
      'Orphaned resource detection',
      'Savings recommendations',
      'Infrastructure monitoring',
      'Active alerts & alert history',
      'Status page',
      'Export reports (CSV/PDF)',
      'API key management',
      'Up to 5 team members',
      'Support: Email',
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
    priceId: 'price_1TIANxH8pNFfrvRPngDy6iGc',
    annualPrice: 239,
    annualPriceId: 'price_pro_annual',
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
      '✨ AI-powered anomaly detection',
      '───────────────',
      'Up to 500 AWS resources',
      '15 resource types',
      'Compliance scanning (SOC 2, HIPAA)',
      'Risk score & trends',
      'SLO Dashboard',
      'DORA metrics & engineering performance',
      'Monitoring overview & health checks',
      'Slack & Jira integrations',
      'Webhook integrations (5 endpoints)',
      'API key management',
      'Up to 10 team members',
      'Support: Priority email',
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
    trialDays: 0,
    features: [
      '✨ Everything in Pro',
      '✨ Scheduled AI Reports (weekly/monthly)',
      '✨ Weekly AI Email Summaries',
      '✨ Custom Anomaly Detection Rules',
      '✨ Advanced AI Insights',
      '───────────────',
      'Unlimited AWS resources',
      '15 resource types',
      'Custom compliance frameworks',
      'SOC 2 & HIPAA named-control audit reports',
      'Auto-remediation workflows',
      'Advanced SLO management',
      'Custom DORA benchmarking',
      'Multi-account monitoring',
      'Full API access',
      'Webhook integrations (unlimited endpoints)',
      'SSO/SAML authentication',
      'Support: Dedicated',
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
]

export default function PricingPage() {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly')

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #fff 100%)',
        padding: '80px 48px 60px',
        textAlign: 'center',
        borderBottom: '1px solid #f3f4f6',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)',
            borderRadius: '100px', padding: '6px 16px',
            fontSize: '0.78rem', fontWeight: 600, color: '#15803d',
            marginBottom: '24px',
          }}>
            <CheckCircle2 size={14} />
            Average $2,400/month AWS savings
          </div>

          <h1 style={{
            fontSize: 'clamp(2rem, 5vw, 3.5rem)',
            fontWeight: 800, color: '#0f172a',
            lineHeight: 1.15, marginBottom: '16px',
            letterSpacing: '-0.02em',
          }}>
            Simple Pricing.{' '}
            <span style={{ color: '#7c3aed' }}>Serious Savings.</span>
          </h1>

          <p style={{
            fontSize: '1.15rem', color: '#374151',
            lineHeight: 1.7, maxWidth: '560px',
            margin: '0 auto 32px',
          }}>
            Start free. Upgrade when you need AI-powered cost optimization,
            security scanning, and DORA metrics.
          </p>

          <div style={{
            display: 'flex', flexWrap: 'wrap',
            justifyContent: 'center', gap: '28px',
            fontSize: '0.875rem', fontWeight: 500, color: '#374151',
          }}>
            {([
              { icon: Clock,     text: '15-min setup' },
              { icon: Shield,    text: 'Read-only AWS access' },
              { icon: Sparkles,  text: 'No credit card required' },
              { icon: Zap,       text: '14-day free trial' },
            ] as const).map(({ icon: Icon, text }) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icon size={16} style={{ color: '#7c3aed' }} />
                {text}
              </div>
            ))}
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
      <section style={{ padding: '40px 48px 80px', width: '100%' }}>
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
                      const text = feature.replace('✨ ', '')
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

      {/* ROI CALCULATOR */}
      <section style={{ padding: '56px 48px 48px', width: '100%', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>

          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center',
              background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)',
              borderRadius: '100px', padding: '6px 16px',
              fontSize: '0.78rem', fontWeight: 700, color: '#7c3aed',
              marginBottom: '16px', letterSpacing: '0.1em', textTransform: 'uppercase' as const,
            }}>
              ROI Calculator
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '12px',
            }}>
              Why Teams Choose DevControl
            </h2>
            <p style={{
              fontSize: '1rem', color: '#374151', lineHeight: 1.7,
              maxWidth: '480px', margin: '0 auto',
            }}>
              Real results from real customers. See how teams save thousands each month.
            </p>
          </div>

          <PricingROI />
        </div>
      </section>

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
