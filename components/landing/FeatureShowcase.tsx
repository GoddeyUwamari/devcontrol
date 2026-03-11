'use client'

import Link from 'next/link'
import { DollarSign, Shield, BarChart2, Activity, Search, Users, ArrowRight } from 'lucide-react'

const features = [
  {
    icon: DollarSign,
    title: 'Cost Optimization',
    description: 'Identify waste and reduce AWS spend by 15-30% with AI-powered recommendations. Average team saves $2,400/month.',
    href: '/features/cost-optimization',
  },
  {
    icon: Shield,
    title: 'Security & Compliance',
    description: 'Automated security scanning across all your AWS resources. Stay SOC 2, HIPAA, and PCI compliant effortlessly.',
    href: '/features/security',
  },
  {
    icon: BarChart2,
    title: 'DORA Metrics',
    description: 'Track deployment frequency, lead time, change failure rate, and MTTR automatically. No manual reporting.',
    href: '/features/dora-metrics',
  },
  {
    icon: Activity,
    title: 'Infrastructure Health',
    description: 'Real-time monitoring of all your AWS services with instant alerts before users are affected.',
    href: '/features/infrastructure-health',
  },
  {
    icon: Search,
    title: 'Resource Discovery',
    description: 'Automatically map every AWS resource across all accounts and regions. Complete visibility in minutes.',
    href: '/features/resource-discovery',
  },
  {
    icon: Users,
    title: 'Team Collaboration',
    description: 'Role-based access, shared dashboards, and team activity feeds. Built for engineering orgs of 5–500.',
    href: '/features/collaboration',
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

export function FeatureShowcase() {
  return (
    <section id="features" style={{ width: '100%', padding: '64px 0', backgroundColor: '#fff' }}>
      <div style={inner}>
        <div style={{ textAlign: 'center', maxWidth: '680px', margin: '0 auto 48px' }}>
          <p style={eyebrow}>Platform Features</p>
          <h2 className="font-extrabold" style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', color: '#7c3aed', marginBottom: '16px', lineHeight: 1.2 }}>
            Everything your AWS team needs,<br />nothing they don&apos;t
          </h2>
          <p style={{ fontSize: '1.125rem', color: '#6b7280', lineHeight: 1.7 }}>
            Complete AWS infrastructure management with real-time insights, cost optimization, and security monitoring.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {features.map((feature) => {
            const Icon = feature.icon
            return (
              <div
                key={feature.title}
                className="bg-white rounded-2xl cursor-pointer"
                style={{
                  border: '1px solid #f3f4f6',
                  padding: '32px',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget
                  el.style.boxShadow = '0 8px 30px rgba(124, 58, 237, 0.12)'
                  el.style.transform = 'translateY(-2px)'
                  el.style.borderColor = '#ede9fe'
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget
                  el.style.boxShadow = 'none'
                  el.style.transform = 'translateY(0)'
                  el.style.borderColor = '#f3f4f6'
                }}
              >
                <div
                  className="rounded-xl flex items-center justify-center"
                  style={{ width: '48px', height: '48px', backgroundColor: '#ede9fe', marginBottom: '24px' }}
                >
                  <Icon className="h-6 w-6" style={{ color: '#7c3aed' }} />
                </div>
                <h3 className="font-bold" style={{ fontSize: '1.125rem', color: '#111827', marginBottom: '12px' }}>{feature.title}</h3>
                <p style={{ color: '#6b7280', fontSize: '14px', lineHeight: 1.7, marginBottom: '20px' }}>{feature.description}</p>
                <Link
                  href={feature.href}
                  className="inline-flex items-center font-semibold"
                  style={{ color: '#7c3aed', fontSize: '14px', textDecoration: 'none', transition: 'all 0.15s ease' }}
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
                  Learn More <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
