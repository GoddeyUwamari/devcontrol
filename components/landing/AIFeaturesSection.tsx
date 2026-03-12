'use client'

import Link from 'next/link'
import { ArrowRight, Sparkles, Mail, MessageSquare, FileText, Target, AlertTriangle, TrendingUp, Search } from 'lucide-react'

const aiFeatures = [
  {
    icon: Sparkles,
    title: 'AI Cost Insights',
    description: 'Explains WHY costs changed, not just THAT they changed.',
    href: '/features/ai-cost-insights',
  },
  {
    icon: Mail,
    title: 'Weekly AI Summaries',
    description: 'Executive briefings delivered to your inbox every Monday.',
    href: '/features/weekly-summaries',
  },
  {
    icon: MessageSquare,
    title: 'AI Chat Assistant',
    description: 'Ask questions in plain English, get instant answers.',
    href: '/features/ai-chat',
  },
  {
    icon: FileText,
    title: 'AI Reports',
    description: 'Comprehensive analytics, auto-generated on-demand.',
    href: '/features/ai-reports',
  },
  {
    icon: Target,
    title: 'Cost Optimization',
    description: 'ML-powered recommendations with estimated savings.',
    href: '/features/cost-optimization',
  },
  {
    icon: AlertTriangle,
    title: 'Anomaly Detection',
    description: 'Catches issues before they become incidents.',
    href: '/features/anomaly-detection',
  },
  {
    icon: TrendingUp,
    title: 'Cost Forecasting',
    description: 'Predict AWS spend 90 days out with 95% accuracy.',
    href: '/features/cost-forecasting',
  },
  {
    icon: Search,
    title: 'Natural Language Search',
    description: '"Find expensive EC2 instances in us-east-1" → instant results.',
    href: '/features/nl-search',
  },
]

const inner: React.CSSProperties = {
  maxWidth: '1400px',
  margin: '0 auto',
  padding: '0 32px',
}

const eyebrow: React.CSSProperties = {
  color: '#7c3aed',
  fontSize: '11px',
  letterSpacing: '0.12em',
  fontWeight: 700,
  textTransform: 'uppercase',
}

export function AIFeaturesSection() {
  return (
    <section id="ai-features" style={{ width: '100%', padding: '64px 0', backgroundColor: '#f9f9fb' }}>
      <div style={inner}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <div
            className="inline-flex items-center gap-2 rounded-full font-semibold"
            style={{ color: '#7c3aed', backgroundColor: '#ede9fe', padding: '6px 16px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', marginBottom: '16px' }}
          >
            <Sparkles className="w-4 h-4" />
            8 AI-Powered Features
          </div>
          <h2 className="font-extrabold" style={{ fontSize: 'clamp(2rem, 4vw, 2.8rem)', color: '#7c3aed', fontWeight: 800, marginBottom: '16px', lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            Built AI-Native, Not AI-Washed
          </h2>
          <p style={{ fontSize: '1.15rem', color: '#374151', maxWidth: '600px', margin: '0 auto', lineHeight: 1.75 }}>
            While competitors bolt on 2–4 AI features, we built 8 from day one.
            Real intelligence, not marketing buzzwords.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5" style={{ marginBottom: '40px' }}>
          {aiFeatures.map((feature) => {
            const Icon = feature.icon
            return (
              <div
                key={feature.title}
                className="bg-white rounded-2xl cursor-pointer"
                style={{
                  border: '1px solid #f3f4f6',
                  padding: '28px',
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
                  style={{
                    backgroundColor: 'rgba(124,58,237,0.12)',
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
                <h3 className="font-bold" style={{ fontSize: '1.1rem', color: '#0f172a', marginBottom: '8px', lineHeight: 1.3 }}>{feature.title}</h3>
                <p style={{ color: '#374151', fontSize: '0.95rem', lineHeight: 1.65, marginBottom: '16px' }}>{feature.description}</p>
                <Link
                  href={feature.href}
                  className="inline-flex items-center font-semibold"
                  style={{ color: '#7c3aed', fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.04em', textDecoration: 'none', transition: 'all 0.15s ease', marginTop: '16px', display: 'inline-flex' }}
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
                  Learn More <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </div>
            )
          })}
        </div>

        <div style={{ textAlign: 'center' }}>
          <Link
            href="/features"
            className="inline-flex items-center gap-2 font-bold text-white rounded-xl"
            style={{
              backgroundColor: '#7c3aed',
              padding: '14px 32px',
              fontSize: '1rem',
              textDecoration: 'none',
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 14px rgba(124,58,237,0.3)',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLAnchorElement
              el.style.backgroundColor = '#6b21a8'
              el.style.transform = 'scale(1.02)'
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLAnchorElement
              el.style.backgroundColor = '#7c3aed'
              el.style.transform = 'scale(1)'
            }}
          >
            Explore All AI Features
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </section>
  )
}
