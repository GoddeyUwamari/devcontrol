'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Sparkles,
  DollarSign,
  AlertTriangle,
  MessageSquare,
  FileText,
  TrendingUp,
  Search,
} from 'lucide-react'

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
    title: "Know Exactly Where You're Losing Money",
    description:
      'Understand what caused cost spikes and uncover hidden waste — with clear actions to reduce spend immediately.',
    highlight: true,
  },
  {
    icon: AlertTriangle,
    title: 'Detect Risks Before They Become Incidents',
    description:
      'Automatically surface anomalies, misconfigurations, and unusual activity before they impact customers or revenue.',
    highlight: false,
  },
  {
    icon: TrendingUp,
    title: 'See Future Costs Before They Happen',
    description:
      'Forecast your AWS spend and prevent budget surprises with accurate forward-looking insights.',
    highlight: false,
  },
  {
    icon: MessageSquare,
    title: 'Ask Anything, Get Instant Answers',
    description:
      'Query your entire infrastructure in plain English — no dashboards, no queries, no complexity.',
    highlight: false,
  },
  {
    icon: FileText,
    title: 'Get Executive-Ready Reports Instantly',
    description:
      'Generate clear, decision-ready reports for leadership, audits, or internal reviews in seconds.',
    highlight: false,
  },
  {
    icon: Search,
    title: 'Find Anything Across Your Infrastructure',
    description:
      'Instantly locate resources, costs, or risks using natural language — no filters or manual digging.',
    highlight: false,
  },
]

export function AIFeaturesSection() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  return (
    <section style={{ width: '100%', padding: isMobile ? '40px 0' : isTablet ? '56px 0' : '64px 0', background: '#f9fafb' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: isMobile ? '0 16px' : isTablet ? '0 24px' : '0 24px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: isMobile ? '32px' : '56px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: '#ede9fe',
              color: '#7c3aed',
              padding: '6px 14px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              marginBottom: '16px',
            }}
          >
            <Sparkles size={14} />
            AI-POWERED INTELLIGENCE
          </div>

          <h2
            style={{
              fontSize: isMobile ? '1.8rem' : isTablet ? '2.2rem' : 'clamp(2.2rem, 4vw, 2.8rem)',
              fontWeight: 800,
              color: '#111827',
              marginBottom: isMobile ? '12px' : '16px',
              lineHeight: 1.2,
            }}
          >
            Your AI Cloud Analyst — Working 24/7
          </h2>

          <p
            style={{
              fontSize: isMobile ? '1rem' : '1.15rem',
              color: '#374151',
              maxWidth: '680px',
              margin: '0 auto',
              lineHeight: 1.7,
            }}
          >
            DevControl continuously analyzes your infrastructure, explains what&apos;s happening,
            and tells you exactly what to do next — without dashboards, spreadsheets, or manual investigation.
          </p>
        </div>

        {/* Proof Strip */}
        <div
          style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: isMobile ? '12px' : '32px',
            flexWrap: 'wrap',
            marginBottom: isMobile ? '40px' : '64px',
            fontSize: isMobile ? '0.85rem' : '0.95rem',
            fontWeight: 500,
            color: '#374151',
          }}
        >
          <span>💰 Identify savings automatically</span>
          <span>⚠️ Detect risks before incidents</span>
          <span>⚡ Get answers in seconds</span>
        </div>

        {/* Grid */}
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
                  background: '#fff',
                  borderRadius: '18px',
                  padding: isMobile ? '20px' : '32px',
                  border: feature.highlight
                    ? '2px solid #7c3aed'
                    : '1px solid #e5e7eb',
                  boxShadow: feature.highlight
                    ? '0 10px 30px rgba(124,58,237,0.15)'
                    : '0 4px 12px rgba(0,0,0,0.04)',
                  transition: 'all 0.2s ease',
                }}
              >
                {feature.highlight && (
                  <div
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      color: '#7c3aed',
                      marginBottom: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    Highest Impact
                  </div>
                )}

                <div
                  style={{
                    background: 'rgba(124,58,237,0.1)',
                    borderRadius: '12px',
                    padding: '10px',
                    display: 'inline-flex',
                    marginBottom: '16px',
                  }}
                >
                  <Icon size={20} color="#7c3aed" />
                </div>

                <h3
                  style={{
                    fontSize: isMobile ? '0.95rem' : '1.05rem',
                    fontWeight: 700,
                    color: '#111827',
                    marginBottom: '8px',
                  }}
                >
                  {feature.title}
                </h3>

                <p
                  style={{
                    fontSize: isMobile ? '0.88rem' : '0.95rem',
                    color: '#4b5563',
                    lineHeight: 1.6,
                  }}
                >
                  {feature.description}
                </p>
              </div>
            )
          })}
        </div>

        {/* Bottom CTA */}
        <div style={{ textAlign: 'center', marginTop: isMobile ? '32px' : '48px' }}>
          <Link
            href="/register"
            style={{
              backgroundColor: '#7c3aed',
              color: '#fff',
              padding: '16px 36px',
              borderRadius: '12px',
              fontWeight: 700,
              textDecoration: 'none',
              boxShadow: '0 8px 28px rgba(124,58,237,0.35)',
              display: isMobile ? 'block' : 'inline-flex',
              width: isMobile ? 'fit-content' : undefined,
              margin: isMobile ? '0 auto' : undefined,
              alignItems: 'center',
              gap: '8px',
            }}
          >
            Run Your First AI Analysis
            <ArrowRight size={18} />
          </Link>

          <p
            style={{
              marginTop: '12px',
              fontSize: '0.85rem',
              color: '#6b7280',
            }}
          >
            No setup. No risk. First insights in 15 minutes.
          </p>
        </div>

      </div>
    </section>
  )
}