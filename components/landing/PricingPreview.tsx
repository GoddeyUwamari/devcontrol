'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { PLANS, TEASER, lines, priceLabel } from '@/lib/plan/plan-catalog'
import type { Tier } from '@/lib/plan/plan-names'
import { FeatureText } from '@/components/billing/feature-line'
import { TrialCta, TrialLine } from '@/components/billing/trial-line'

function useWindowWidth() {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}

/** Teaser copy per plan; the plan name, price and feature lines come from the catalog. */
const TEASER_META: Record<Tier, { period: string; highlight: string; cta?: { label: string; href: string } }> = {
  free: { period: 'forever', highlight: 'For personal projects', cta: { label: 'Start Free Forever', href: '/register' } },
  starter: { period: '/month', highlight: 'For small teams' },
  pro: { period: '/month', highlight: 'Most Popular' },
  enterprise: { period: '', highlight: 'For large orgs', cta: { label: 'Talk to Sales', href: '/contact' } },
}

function ctaStyle(highlighted: boolean): CSSProperties {
  return {
    padding: '12px 16px',
    fontSize: '14px',
    textDecoration: 'none',
    transition: 'all 0.15s ease',
    ...(highlighted
      ? { backgroundColor: '#7c3aed', color: '#fff' }
      : { backgroundColor: '#f3f4f6', color: '#1f2937' }),
  }
}

const tiers = PLANS.map((p) => ({
  tier: p.tier,
  name: p.name,
  price: priceLabel(p.tier, 'monthly'),
  highlighted: !!p.popular,
  features: lines(TEASER[p.tier]),
  ...TEASER_META[p.tier],
}))

const inner: React.CSSProperties = {
  maxWidth: '1400px',
  margin: '0 auto',
  padding: '0 32px',
}

export function PricingPreview() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  return (
    <section id="pricing" style={{ width: '100%', padding: isMobile ? '40px 0' : '64px 0', backgroundColor: '#fff' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: isMobile ? '0 16px' : isTablet ? '0 24px' : '0 32px' }}>
        <div style={{ textAlign: 'center', maxWidth: '600px', margin: isMobile ? '0 auto 32px' : '0 auto 48px' }}>

          {/* Eyebrow pill — solid violet matching page standard */}
          <div style={{ marginBottom: '16px' }}>
            <span style={{
              display: 'inline-block',
              backgroundColor: '#7c3aed',
              color: '#ffffff',
              padding: '6px 14px',
              borderRadius: '999px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}>
              Pricing
            </span>
          </div>

          <h2 className="font-extrabold" style={{ fontSize: isMobile ? '1.8rem' : isTablet ? '2.2rem' : 'clamp(2rem, 4vw, 2.8rem)', color: '#7c3aed', fontWeight: 800, marginBottom: '14px', lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            Start free. Scale as you grow.
          </h2>
          <p style={{ fontSize: isMobile ? '1.1rem' : '1.2rem', color: '#1f2937', lineHeight: 1.75 }}>
            Start on the free Visibility plan. Upgrade when you need more.
            <TrialLine variant="table" prefix=" " />
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '24px', marginBottom: isMobile ? '24px' : '36px' }}>
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className="relative bg-white rounded-2xl flex flex-col"
              style={{
                border: tier.highlighted ? '2px solid #7c3aed' : '2px solid #e5e7eb',
                boxShadow: tier.highlighted ? '0 8px 30px rgba(124,58,237,0.15)' : 'none',
                transform: tier.highlighted && !isMobile ? 'scale(1.03)' : 'none',
                padding: isMobile ? '24px 16px' : '32px 24px',
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
                <h3 className="font-bold" style={{ fontSize: '1.2rem', color: '#1e1b4b', marginBottom: '4px', lineHeight: 1.3 }}>{tier.name}</h3>
                <p style={{ fontSize: '12px', color: '#1f2937', marginBottom: '16px' }}>{tier.highlight}</p>
                <div className="flex items-baseline gap-1">
                  <span className="font-extrabold" style={{ fontSize: isMobile ? '1.8rem' : '2.25rem', color: '#111827' }}>{tier.price}</span>
                  {tier.period && <span style={{ color: '#6b7280', fontSize: '14px' }}>{tier.period}</span>}
                </div>
              </div>

              <ul style={{ marginBottom: '24px', flex: 1 }} className="space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature.id} className="flex items-center gap-2" style={{ fontSize: '14px', color: '#1f2937' }}>
                    <Check className="h-4 w-4 flex-shrink-0" style={{ color: feature.badge === 'Coming soon' ? '#9ca3af' : '#7c3aed' }} />
                    <FeatureText feature={feature} aiChip={false} />
                  </li>
                ))}
              </ul>

              {tier.cta ? (
                <Link
                  href={tier.cta.href}
                  className="block text-center rounded-xl font-semibold"
                  style={{ ...ctaStyle(tier.highlighted) }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLAnchorElement
                    el.style.opacity = '0.85'
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLAnchorElement
                    el.style.opacity = '1'
                  }}
                >
                  {tier.cta.label}
                </Link>
              ) : (
                <TrialCta plan={tier.tier} className="block text-center rounded-xl font-semibold" style={ctaStyle(tier.highlighted)} />
              )}
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

        <div className="flex flex-wrap items-center justify-center" style={{ gap: isMobile ? '12px' : '24px', fontSize: isMobile ? '13px' : '14px', color: '#6b7280' }}>
          <TrialLine
            variant="chip"
            className="flex items-center gap-2"
            icon="check"
            iconClassName="h-4 w-4"
            iconStyle={{ color: '#16a34a' }}
            textSpan
          />
          {['Free Visibility plan', 'Cancel anytime', 'No hidden fees', 'SOC 2 Readiness Planned'].map((item) => (
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