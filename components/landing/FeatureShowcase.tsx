'use client'

import Link from 'next/link'
import { DollarSign, Shield, BarChart2, Activity, Search, Users } from 'lucide-react'

const features = [
  {
    icon: DollarSign,
    title: 'Cut AWS Costs by 30%',
    description: 'Identify waste, unused resources, and right-sizing opportunities automatically. Average team saves $2,400/month.',
    href: '/features/cost-optimization',
  },
  {
    icon: Shield,
    title: 'Security & Compliance',
    description: 'Automated scanning across all AWS resources. Stay SOC 2, HIPAA, and PCI compliant without manual audits.',
    href: '/features/security',
  },
  {
    icon: BarChart2,
    title: 'DORA Metrics',
    description: 'Track deployment frequency, lead time, change failure rate, and MTTR automatically. No spreadsheets.',
    href: '/features/dora-metrics',
  },
  {
    icon: Activity,
    title: 'Infrastructure Health',
    description: 'Real-time monitoring across all your AWS services with instant alerts before users are affected.',
    href: '/features/infrastructure-health',
  },
  {
    icon: Search,
    title: 'Full Resource Visibility',
    description: 'Map every AWS resource across all accounts and regions. Complete inventory in under 15 minutes.',
    href: '/features/resource-discovery',
  },
  {
    icon: Users,
    title: 'Team Governance',
    description: 'Role-based access, shared dashboards, and audit logs. Built for engineering orgs of 5 to 500.',
    href: '/features/collaboration',
  },
]

export function FeatureShowcase() {
  return (
    <section
      id="features"
      style={{ width: '100%', padding: '80px 0', backgroundColor: '#fff' }}
    >
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 32px' }}>

        <h2
          style={{
            fontSize: 'clamp(2.6rem, 5vw, 3rem)',
            color: '#7c3aed',
            fontWeight: 800,
            lineHeight: 1.15,
            textAlign: 'center',
            marginBottom: '16px',
          }}
        >
          Your AWS Infrastructure, Finally Under Control
        </h2>

        <p
          style={{
            fontSize: '1.15rem',
            color: '#374151',
            lineHeight: 1.75,
            maxWidth: '620px',
            textAlign: 'center',
            margin: '0 auto 48px',
          }}
        >
          Cut costs, fix security gaps, and track engineering performance — all from one AI-powered dashboard.
        </p>

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
                  border: '1.5px solid #e5e7eb',
                  padding: '40px',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget
                  el.style.borderColor = '#7c3aed'
                  el.style.boxShadow = '0 4px 24px rgba(124,58,237,0.10)'
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget
                  el.style.borderColor = '#e5e7eb'
                  el.style.boxShadow = 'none'
                }}
              >
                <div
                  style={{
                    backgroundColor: 'rgba(124,58,237,0.06)',
                    borderRadius: '14px',
                    padding: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '16px',
                  }}
                >
                  <Icon style={{ color: '#7c3aed' }} size={22} />
                </div>
                <h3
                  style={{
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    color: '#0f172a',
                    marginTop: '20px',
                    marginBottom: '8px',
                    lineHeight: 1.3,
                  }}
                >
                  {feature.title}
                </h3>
                <p
                  style={{
                    fontSize: '0.95rem',
                    color: '#374151',
                    lineHeight: 1.65,
                    marginTop: '8px',
                    marginBottom: 0,
                  }}
                >
                  {feature.description}
                </p>
                <Link
                  href={feature.href}
                  style={{
                    display: 'inline-block',
                    color: '#7c3aed',
                    fontWeight: 700,
                    fontSize: '0.875rem',
                    letterSpacing: '0.04em',
                    marginTop: '16px',
                    textDecoration: 'none',
                    transition: 'text-decoration 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLAnchorElement
                    el.style.textDecoration = 'underline'
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLAnchorElement
                    el.style.textDecoration = 'none'
                  }}
                >
                  Learn More →
                </Link>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}