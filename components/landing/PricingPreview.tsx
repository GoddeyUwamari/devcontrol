'use client'

import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    highlight: 'For personal projects',
    highlighted: false,
    features: [
      '20 AWS resources',
      'Basic cost dashboard',
      '7-day data history',
      'Email alerts',
    ],
    cta: 'Get Started Free',
    ctaHref: '/register',
  },
  {
    name: 'Starter',
    price: '$79',
    period: '/month',
    highlight: 'For small teams',
    highlighted: false,
    features: [
      '60 AWS resources',
      'AI cost insights',
      '30-day history',
      'Slack alerts',
      '3 team members',
    ],
    cta: 'Start Free Trial',
    ctaHref: '/register',
  },
  {
    name: 'Pro',
    price: '$299',
    period: '/month',
    highlight: 'Most Popular',
    highlighted: true,
    features: [
      '500 AWS resources',
      'All 8 AI features',
      '90-day history',
      'DORA metrics',
      'Unlimited members',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    ctaHref: '/register',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    highlight: 'For large orgs',
    highlighted: false,
    features: [
      'Unlimited resources',
      'Custom integrations',
      'Unlimited history',
      'SSO / SAML',
      'Dedicated CSM',
      'SLA guarantee',
    ],
    cta: 'Talk to Sales',
    ctaHref: '/contact',
  },
]

const inner: React.CSSProperties = {
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '0 48px',
}

const eyebrow: React.CSSProperties = {
  color: '#7c3aed',
  fontSize: '13px',
  letterSpacing: '0.1em',
  fontWeight: 600,
  textTransform: 'uppercase',
  marginBottom: '12px',
}

export function PricingPreview() {
  return (
    <section id="pricing" style={{ width: '100%', padding: '64px 0', backgroundColor: '#fff' }}>
      <div style={inner}>
        <div style={{ textAlign: 'center', maxWidth: '600px', margin: '0 auto 48px' }}>
          <p style={eyebrow}>Pricing</p>
          <h2 className="font-extrabold" style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', color: '#7c3aed', marginBottom: '14px', lineHeight: 1.2 }}>
            Start free. Scale as you grow.
          </h2>
          <p style={{ fontSize: '1.125rem', color: '#6b7280', lineHeight: 1.7 }}>
            All plans include a 14-day free trial. No credit card required.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6" style={{ marginBottom: '36px' }}>
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className="relative bg-white rounded-2xl flex flex-col"
              style={{
                border: tier.highlighted ? '2px solid #7c3aed' : '1px solid #f3f4f6',
                boxShadow: tier.highlighted ? '0 8px 30px rgba(124,58,237,0.15)' : '0 2px 8px rgba(0,0,0,0.04)',
                transform: tier.highlighted ? 'scale(1.03)' : 'none',
                padding: '32px 24px',
              }}
            >
              {tier.highlighted && (
                <div
                  className="absolute left-1/2 -translate-x-1/2 rounded-full text-white font-bold whitespace-nowrap"
                  style={{ top: '-14px', backgroundColor: '#7c3aed', padding: '4px 16px', fontSize: '12px' }}
                >
                  Most Popular
                </div>
              )}

              <div style={{ marginBottom: '24px' }}>
                <h3 className="font-bold" style={{ fontSize: '1.125rem', color: '#111827', marginBottom: '4px' }}>{tier.name}</h3>
                <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '16px' }}>{tier.highlight}</p>
                <div className="flex items-baseline gap-1">
                  <span className="font-extrabold" style={{ fontSize: '2.25rem', color: '#111827' }}>{tier.price}</span>
                  {tier.period && <span style={{ color: '#9ca3af', fontSize: '14px' }}>{tier.period}</span>}
                </div>
              </div>

              <ul style={{ marginBottom: '24px', flex: 1 }} className="space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2" style={{ fontSize: '14px', color: '#6b7280' }}>
                    <Check className="h-4 w-4 flex-shrink-0" style={{ color: '#7c3aed' }} />
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href={tier.ctaHref}
                className="block text-center rounded-xl font-semibold"
                style={{
                  padding: '12px 16px',
                  fontSize: '14px',
                  textDecoration: 'none',
                  transition: 'all 0.15s ease',
                  ...(tier.highlighted
                    ? { backgroundColor: '#7c3aed', color: '#fff' }
                    : { backgroundColor: '#f3f4f6', color: '#374151' }),
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLAnchorElement
                  el.style.opacity = '0.85'
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLAnchorElement
                  el.style.opacity = '1'
                }}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 font-semibold"
            style={{ color: '#7c3aed', textDecoration: 'none', fontSize: '15px', transition: 'all 0.15s ease' }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLAnchorElement
              el.style.color = '#6b21a8'
              el.style.textDecoration = 'underline'
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLAnchorElement
              el.style.color = '#7c3aed'
              el.style.textDecoration = 'none'
            }}
          >
            See full pricing comparison
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-6" style={{ fontSize: '14px', color: '#9ca3af' }}>
          {['14-day free trial', 'No credit card required', 'Cancel anytime'].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <Check className="h-4 w-4" style={{ color: '#16a34a' }} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
