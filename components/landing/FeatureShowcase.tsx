'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DollarSign, Shield, BarChart2, Activity, Search, Users } from 'lucide-react'

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

const features = [
  {
    icon: DollarSign,
    title: 'Cut Cloud Spend Immediately',
    description:
      'Surface unused resources, over-provisioned services, and hidden waste — so you can reduce costs the same day. Teams typically uncover $800–$8,000+/month in waste.',
    highlight: true,
    href: '/features/cost-optimization',
  },
  {
    icon: Shield,
    title: 'Avoid Costly Security Failures',
    description:
      'Continuously detect misconfigurations and compliance risks before audits or breaches impact the business.',
    highlight: false,
    href: '/features/security',
  },
  {
    icon: Activity,
    title: 'Catch Issues Before Customers Do',
    description:
      'Real-time infrastructure health and alerts — so incidents are resolved before they affect revenue or user experience.',
    highlight: false,
    href: '/features/infrastructure-health',
  },
  {
    icon: Search,
    title: "See What You're Actually Paying For",
    description:
      'Full visibility across all AWS accounts and regions — no blind spots, no hidden costs, no guesswork.',
    highlight: false,
    href: '/features/resource-discovery',
  },
  {
    icon: BarChart2,
    title: 'Know If Engineering Is Delivering',
    description:
      'Track deployment speed, reliability, and failure rates — without relying on manual reporting or spreadsheets.',
    highlight: false,
    href: '/features/dora-metrics',
  },
  {
    icon: Users,
    title: 'Control Team Spend & Access',
    description:
      'Set guardrails, manage permissions, and track changes across teams — built for growing engineering organizations.',
    highlight: false,
    href: '/features/collaboration',
  },
]

export function FeatureShowcase() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  return (
    <section style={{ width: '100%', padding: isMobile ? '40px 0' : isTablet ? '56px 0' : '64px 0', backgroundColor: '#fff' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: isMobile ? '0 16px' : isTablet ? '0 24px' : '0 32px' }}>

        {/* Eyebrow label */}
        <p style={{
          fontSize: '0.78rem',
          fontWeight: 700,
          color: '#7c3aed',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          textAlign: 'center',
          marginBottom: '12px',
        }}>
          🔍 AWS Cost &amp; Risk Audit
        </p>

        <h2
          style={{
            fontSize: isMobile ? '1.8rem' : isTablet ? '2.2rem' : 'clamp(2.6rem, 5vw, 3rem)',
            color: '#7c3aed',
            fontWeight: 800,
            textAlign: 'center',
            marginBottom: isMobile ? '12px' : '16px',
          }}
        >
          What You&apos;ll Know in 15 Minutes
        </h2>

        <p
          style={{
            fontSize: isMobile ? '1rem' : '1.2rem',
            color: '#1f2937',
            maxWidth: '680px',
            textAlign: 'center',
            margin: isMobile ? '0 auto 24px' : '0 auto 32px',
            lineHeight: 1.7,
          }}
        >
          After one scan, you&apos;ll have complete clarity on your cloud costs, risks, and performance — without digging through dashboards.
        </p>

        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: isMobile ? '12px' : '32px',
            flexWrap: 'wrap',
            marginBottom: isMobile ? '32px' : '56px',
            fontSize: isMobile ? '0.85rem' : '0.95rem',
            color: '#1f2937',
            fontWeight: 500,
          }}
        >
          <span>💰 20–40% cloud waste uncovered</span>
          <span>⚠️ Critical risks identified early</span>
          <span>⚡ Insights in under 15 minutes</span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gap: '24px',
          }}
        >
          {features.map((feature) => {
            const Icon = feature.icon
            return (
              <div
                key={feature.title}
                style={{
                  backgroundColor: '#fff',
                  borderRadius: '16px',
                  border: '2px solid #e5e7eb',
                  padding: isMobile ? '24px' : '40px',
                  boxShadow: 'none',
                  transition: 'all 0.2s ease',
                }}
              >
                {feature.highlight && (
                  <div
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      color: '#7c3aed',
                      marginBottom: '12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    Highest Impact
                  </div>
                )}

                <div
                  style={{
                    backgroundColor: 'rgba(124,58,237,0.12)',
                    borderRadius: '14px',
                    padding: '12px',
                    display: 'inline-flex',
                    marginBottom: '16px',
                  }}
                >
                  <Icon style={{ color: '#7c3aed' }} size={22} />
                </div>

                <h3
                  style={{
                    fontSize: isMobile ? '1rem' : '1.15rem',
                    fontWeight: 700,
                    color: '#1e1b4b',
                    marginBottom: '10px',
                  }}
                >
                  {feature.title}
                </h3>

                <p
                  style={{
                    fontSize: isMobile ? '0.88rem' : '0.95rem',
                    color: '#1f2937',
                    lineHeight: 1.65,
                  }}
                >
                  {feature.description}
                </p>

                <Link
                  href={feature.href}
                  style={{
                    display: isMobile ? 'block' : 'inline-block',
                    marginTop: '18px',
                    color: '#7c3aed',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    textDecoration: 'none',
                    width: isMobile ? 'fit-content' : undefined,
                    margin: isMobile ? '18px auto 0' : undefined,
                  }}
                >
                  Learn More →
                </Link>
              </div>
            )
          })}
        </div>

        <div style={{ textAlign: 'center', marginTop: '40px' }}>
          <Link
            href="/register"
            style={{
              backgroundColor: '#7c3aed',
              color: '#fff',
              padding: '16px 36px',
              borderRadius: '12px',
              fontWeight: 700,
              textDecoration: 'none',
              boxShadow: '0 6px 24px rgba(124,58,237,0.35)',
              display: isMobile ? 'block' : undefined,
              width: isMobile ? 'fit-content' : undefined,
              margin: isMobile ? '0 auto' : undefined,
            }}
          >
            Scan My AWS for Cost &amp; Risk →
          </Link>
        </div>

      </div>
    </section>
  )