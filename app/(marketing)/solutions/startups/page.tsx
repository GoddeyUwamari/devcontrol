'use client'

import { Zap, DollarSign, Shield, BarChart3, Clock, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'

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

export default function StartupsPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  const features = [
    { icon: DollarSign, title: 'Stop AWS Bill Shock', desc: 'Get instant visibility into every dollar of AWS spend. AI recommendations find idle resources, right-sizing opportunities, and budget leaks before your next invoice.', highlight: true },
    { icon: Zap, title: 'Ship Faster with DORA Metrics', desc: 'Automatically track deployment frequency, lead time, change failure rate, and MTTR. Show your Series A investors Elite-tier engineering velocity with real data.' },
    { icon: Shield, title: 'SOC 2 Readiness from Day One', desc: 'Continuous compliance monitoring mapped to SOC 2 controls. Stop losing enterprise deals because you can\'t answer security questionnaires fast enough.' },
    { icon: Clock, title: '15-Minute Setup', desc: 'Read-only IAM role, no agents, no code changes. Connect your AWS account and get your first insights in under 15 minutes — not days or weeks.' },
    { icon: BarChart3, title: 'Investor-Ready Dashboards', desc: 'Cost efficiency, security posture, and engineering performance metrics in one dashboard. Give your board and investors the visibility they demand.' },
    { icon: TrendingUp, title: 'Scale Without Surprises', desc: 'Anomaly detection catches cost spikes and security regressions as you grow. Stay in control of your infrastructure as your team and traffic scales.' },
  ]

  const impacts = [
    { value: '$2,400', label: 'Average monthly savings found' },
    { value: '15min', label: 'Time to first insight' },
    { value: '2 weeks', label: 'To establish SOC 2 compliance baseline' },
  ]

  const steps = [
    { step: '01', title: 'Connect Your AWS Account', desc: 'One-click read-only IAM setup. No engineers pulled off product work, no security risk, no complexity.' },
    { step: '02', title: 'Get Your Full Picture', desc: 'Costs, security posture, DORA metrics, and resource inventory — all calculated automatically within minutes.' },
    { step: '03', title: 'Grow With Confidence', desc: 'AI recommendations keep your spend optimized, your security tight, and your engineering velocity measurable as you scale.' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #fff 100%)',
        padding: isMobile ? '60px 20px' : isTablet ? '70px 32px' : '80px 48px',
        borderBottom: '1px solid #f3f4f6',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', textAlign: 'center' }}>

          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(124,58,237,0.2)',
            borderRadius: '100px', padding: '6px 16px',
            fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
            marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Solutions · For Startups
          </div>

          <h1 style={{
            fontSize: isMobile ? '1.9rem' : 'clamp(2.2rem, 5vw, 3.2rem)',
            fontWeight: 800, color: '#0f172a',
            lineHeight: 1.15, marginBottom: '20px',
            letterSpacing: '-0.02em', maxWidth: '800px', margin: '0 auto 20px',
          }}>
            The AWS Control Center{' '}
            <span style={{ color: '#7c3aed' }}>Built for Startups Moving Fast</span>
          </h1>

          <p style={{
            fontSize: isMobile ? '1rem' : '1.15rem', color: '#374151',
            lineHeight: 1.75, maxWidth: '620px',
            margin: '0 auto 36px',
          }}>
            Cut AWS waste, prove engineering velocity to investors, and get SOC 2 ready —
            without hiring a dedicated DevOps team or taking engineers off product work.
          </p>

          <div style={{
            display: 'flex', gap: '16px', justifyContent: 'center',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'center' : undefined,
            flexWrap: 'wrap', marginBottom: '36px',
          }}>
            <a href="/register" style={{
              background: '#7c3aed', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              Start Free — No Credit Card
            </a>
            <a href="/tour" style={{
              background: 'transparent', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '1.5px solid #7c3aed',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              See How It Works
            </a>
          </div>

          <div style={{
            display: 'flex', flexWrap: 'wrap',
            justifyContent: 'center', gap: '16px',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: 'center',
            fontSize: '0.875rem', fontWeight: 500, color: '#374151',
          }}>
            {['Free plan available', '15-minute setup', 'No DevOps hire needed'].map(t => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#16a34a' }}>✓</span> {t}
              </span>
            ))}
          </div>
          <p style={{ fontSize: '0.9rem', color: '#374151', marginTop: '24px', fontStyle: 'italic' }}>
            {'A seed-stage startup cut their AWS bill by $1,800/month and closed their first enterprise deal within 6 weeks of connecting DevControl.'}
          </p>
        </div>
      </section>

      {/* BUSINESS IMPACT BAR */}
      <section style={{ padding: isMobile ? '32px 20px' : isTablet ? '40px 32px' : '48px', background: '#fafafa', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{
          maxWidth: '1400px', margin: '0 auto',
          display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
          gap: isMobile ? '24px' : '32px', textAlign: 'center',
        }}>
          {impacts.map(({ value, label }) => (
            <div key={label}>
              <div style={{ fontSize: isMobile ? '2rem' : '2.5rem', fontWeight: 800, color: '#7c3aed', lineHeight: 1 }}>
                {value}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#374151', fontWeight: 500, marginTop: '8px' }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px', width: '100%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Built for Startup Velocity
            </div>
            <h2 style={{
              fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              Everything a Startup Needs. Nothing It Doesn&apos;t.
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              Enterprise-grade AWS visibility at a price and complexity level that works for lean teams.
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gap: '24px',
          }}>
            {features.map(({ icon: Icon, title, desc, highlight }) => (
              <div key={title} style={{
                background: '#fff',
                border: highlight ? '2px solid #7c3aed' : '1.5px solid #e5e7eb',
                borderRadius: '16px', padding: isMobile ? '24px' : '32px',
                boxShadow: highlight ? '0 8px 32px rgba(124,58,237,0.15)' : 'none',
                transition: 'all 0.2s ease',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#7c3aed'
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(124,58,237,0.12)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = highlight ? '#7c3aed' : '#e5e7eb'
                  e.currentTarget.style.boxShadow = highlight ? '0 8px 32px rgba(124,58,237,0.15)' : 'none'
                }}
              >
                {highlight && (
                  <div style={{
                    fontSize: '0.7rem', fontWeight: 700, color: '#7c3aed',
                    marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}>
                    Most Impactful for Startups
                  </div>
                )}
                <div style={{
                  width: '48px', height: '48px', borderRadius: '12px',
                  background: 'rgba(124,58,237,0.14)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '20px',
                }}>
                  <Icon size={22} style={{ color: '#7c3aed' }} />
                </div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', marginBottom: '10px' }}>
                  {title}
                </h3>
                <p style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.75 }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Quick Setup
            </div>
            <h2 style={{
              fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              Up and Running Before Lunch
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gap: '32px',
          }}>
            {steps.map(({ step, title, desc }) => (
              <div key={step} style={{ textAlign: 'center' }}>
                <div style={{
                  width: '56px', height: '56px', borderRadius: '50%',
                  background: '#7c3aed', color: '#fff',
                  fontSize: '1rem', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 20px',
                }}>
                  {step}
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f172a', marginBottom: '12px' }}>
                  {title}
                </h3>
                <p style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.75 }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section style={{ padding: isMobile ? '40px 20px' : isTablet ? '52px 32px' : '64px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <p style={{
              fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Real Startup Result
            </p>
            <h2 style={{
              fontSize: isMobile ? '1.3rem' : 'clamp(1.5rem, 2.5vw, 2rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '8px',
            }}>
              From Seed to Enterprise-Ready in 6 Weeks
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '480px', margin: '0 auto' }}>
              How a seed-stage fintech used DevControl to cut costs, close enterprise deals, and raise their Series A.
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: '0',
            position: 'relative',
          }}>
            {[
              {
                week: 'Week 1',
                color: '#7c3aed',
                title: 'Connected AWS',
                body: 'Setup took 8 minutes. Discovered $1,800/month in idle resources immediately.',
                outcome: '$1,800/mo found',
              },
              {
                week: 'Week 2',
                color: '#7c3aed',
                title: 'Fixed Cost Leaks',
                body: 'Terminated unused EC2 instances and right-sized 3 RDS databases.',
                outcome: '24% bill reduction',
              },
              {
                week: 'Week 3',
                color: '#7c3aed',
                title: 'SOC 2 Baseline',
                body: 'Compliance dashboard surfaced 12 security findings. All resolved in 4 days.',
                outcome: 'Audit-ready posture',
              },
              {
                week: 'Week 6',
                color: '#059669',
                title: 'Enterprise Deal Closed',
                body: 'Used DevControl compliance dashboard to answer security questionnaire in 20 minutes.',
                outcome: 'First enterprise logo',
              },
            ].map(({ week, color, title, body, outcome }, i) => (
              <div key={week} style={{
                padding: isMobile ? '20px' : '28px 24px',
                background: '#fff',
                border: '1px solid #E2E8F0',
                borderLeft: isMobile ? '1px solid #E2E8F0' : (i === 0 ? '1px solid #E2E8F0' : 'none'),
                borderTop: isMobile && i > 0 ? 'none' : '1px solid #E2E8F0',
                borderRadius: isMobile
                  ? (i === 0 ? '16px 16px 0 0' : i === 3 ? '0 0 16px 16px' : '0')
                  : (i === 0 ? '16px 0 0 16px' : i === 3 ? '0 16px 16px 0' : '0'),
                position: 'relative',
              }}>
                <p style={{ fontSize: '0.68rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 10px' }}>{week}</p>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>{title}</h3>
                <p style={{ fontSize: '0.82rem', color: '#374151', lineHeight: 1.6, margin: '0 0 16px' }}>{body}</p>
                <span style={{
                  display: 'inline-block',
                  background: color === '#059669' ? '#ECFDF5' : '#EDE9FE',
                  color,
                  padding: '3px 10px', borderRadius: '999px',
                  fontSize: '11px', fontWeight: 600,
                }}>
                  {outcome}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Your Stage. Your Needs.
            </div>
            <h2 style={{
              fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              Who It&apos;s For
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
            gap: '24px',
          }}>
            <div style={{
              background: '#fff', border: '1.5px solid #e5e7eb',
              borderRadius: '20px', padding: isMobile ? '28px' : '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: 'rgba(124,58,237,0.14)',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For Founders &amp; CEOs
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Close More Deals. Raise Your Next Round.
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Show investors real engineering velocity metrics',
                  'Answer enterprise security questionnaires in minutes',
                  'Control AWS costs before they kill your runway',
                  'Board-level infrastructure visibility without the overhead',
                ].map(point => (
                  <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ color: '#7c3aed', fontWeight: 700, marginTop: '1px' }}>✓</span>
                    <span style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6 }}>{point}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
              border: '1.5px solid rgba(124,58,237,0.2)',
              borderRadius: '20px', padding: isMobile ? '28px' : '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: '#7c3aed',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For CTOs &amp; Lead Engineers
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Enterprise Tooling Without the Enterprise Overhead
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Full AWS visibility with zero infrastructure agents',
                  'DORA metrics from your existing GitHub setup',
                  'Security scanning without a dedicated security team',
                  'Scales with you from seed to Series B and beyond',
                ].map(point => (
                  <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ color: '#7c3aed', fontWeight: 700, marginTop: '1px' }}>✓</span>
                    <span style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6 }}>{point}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
        padding: isMobile ? '56px 20px' : isTablet ? '64px 32px' : '80px 48px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800,
            color: '#fff', marginBottom: '16px', letterSpacing: '-0.02em',
          }}>
            Built for Startups. Priced for Startups.
          </h2>
          <p style={{
            fontSize: '1.1rem', color: 'rgba(255,255,255,0.85)',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            Start free. Get your AWS costs, security score, and DORA metrics in 15 minutes.
          </p>
          <div style={{
            display: 'flex', gap: '16px', justifyContent: 'center',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'center' : undefined,
            flexWrap: 'wrap',
          }}>
            <a href="/register" style={{
              background: '#fff', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              Start Free Forever
            </a>
            <a href="/pricing" style={{
              background: 'transparent', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.4)',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              View Pricing
            </a>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginTop: '16px' }}>
            Free plan available · No credit card required · Upgrade anytime
          </div>
        </div>
      </section>

    </div>
  )
}
