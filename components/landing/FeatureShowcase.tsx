'use client'

import Link from 'next/link'
import { DollarSign, Shield, BarChart2, Activity, Search, Users } from 'lucide-react'

const features = [
  {
    icon: DollarSign,
    title: 'Cut Cloud Spend Immediately',
    description:
      'Surface unused resources, over-provisioned services, and hidden waste — so you can reduce costs the same day. Average team saves $2,400/month.',
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
  return (
    <section style={{ width: '100%', padding: '100px 0', backgroundColor: '#fff' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 32px' }}>

        <h2
          style={{
            fontSize: 'clamp(2.6rem, 5vw, 3rem)',
            color: '#7c3aed',
            fontWeight: 800,
            textAlign: 'center',
            marginBottom: '16px',
          }}
        >
          What You&apos;ll Know in 15 Minutes
        </h2>

        <p
          style={{
            fontSize: '1.2rem',
            color: '#374151',
            maxWidth: '680px',
            textAlign: 'center',
            margin: '0 auto 32px',
            lineHeight: 1.7,
          }}
        >
          After one scan, you&apos;ll have complete clarity on your cloud costs, risks, and performance — without digging through dashboards.
        </p>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '32px',
            flexWrap: 'wrap',
            marginBottom: '56px',
            fontSize: '0.95rem',
            color: '#374151',
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
            gridTemplateColumns: 'repeat(3, 1fr)',
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
                  border: feature.highlight
                    ? '2px solid #7c3aed'
                    : '1.5px solid #e5e7eb',
                  padding: '40px',
                  boxShadow: feature.highlight
                    ? '0 8px 32px rgba(124,58,237,0.15)'
                    : 'none',
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
                    backgroundColor: 'rgba(124,58,237,0.06)',
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
                    fontSize: '1.15rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    marginBottom: '10px',
                  }}
                >
                  {feature.title}
                </h3>

                <p
                  style={{
                    fontSize: '0.95rem',
                    color: '#374151',
                    lineHeight: 1.65,
                  }}
                >
                  {feature.description}
                </p>

                <Link
                  href={feature.href}
                  style={{
                    display: 'inline-block',
                    marginTop: '18px',
                    color: '#7c3aed',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    textDecoration: 'none',
                  }}
                >
                  Learn More →
                </Link>
              </div>
            )
          })}
        </div>

        <div style={{ textAlign: 'center', marginTop: '64px' }}>
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
            }}
          >
            Scan My AWS for Cost &amp; Risk →
          </Link>
        </div>

      </div>
    </section>
  )
}