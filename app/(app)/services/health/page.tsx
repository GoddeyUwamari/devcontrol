'use client'

import { Activity, AlertTriangle, Bell, BarChart3, Clock, Shield } from 'lucide-react'

export default function ServiceHealthPage() {

  const features = [
    { icon: Activity, title: 'Real-time Service Health', desc: 'Live health status for every service across your AWS infrastructure. Aggregate health scores surface degradation before your users file a support ticket.' },
    { icon: AlertTriangle, title: 'Incident Detection & Alerting', desc: 'Instant alerts the moment a service degrades or goes down. Configurable thresholds per service ensure you only get alerted on what matters.' },
    { icon: Clock, title: 'Uptime Tracking & SLA Monitoring', desc: 'Track uptime percentages per service and against your SLA commitments. Historical uptime data ready for customer-facing status pages and board reports.' },
    { icon: BarChart3, title: 'Performance Trend Analysis', desc: 'Latency, error rate, and throughput trends over time. Identify services that are slowly degrading before they cause a production incident.' },
    { icon: Bell, title: 'Smart Notification Routing', desc: 'Route alerts to the right team via Slack, PagerDuty, or email. On-call schedules, escalation policies, and alert fatigue prevention built in.' },
    { icon: Shield, title: 'Dependency Health Mapping', desc: 'See how a degraded service impacts every downstream dependency. Understand blast radius instantly and prioritize incident response with confidence.' },
  ]

  const impacts = [
    { value: '99.9%', label: 'Average uptime after onboarding' },
    { value: '< 2min', label: 'Mean time to alert on incidents' },
    { value: '60%', label: 'Reduction in MTTR' },
  ]

  const steps = [
    { step: '01', title: 'Connect Your AWS Account', desc: 'Grant read-only IAM access. DevControl immediately starts monitoring health across all your services, regions, and accounts.' },
    { step: '02', title: 'Health Baseline Established', desc: 'DevControl learns your normal performance patterns and sets smart alert thresholds — no manual configuration required.' },
    { step: '03', title: 'Monitor, Alert & Resolve', desc: 'Get instant alerts on degradation, see dependency impact maps, and track MTTR improvements over time from one dashboard.' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #fff 100%)',
        padding: '80px 48px',
        borderBottom: '1px solid #f3f4f6',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', textAlign: 'center' }}>

          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)',
            borderRadius: '100px', padding: '6px 16px',
            fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
            marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Platform · Service Health
          </div>

          <h1 style={{
            fontSize: 'clamp(2.2rem, 5vw, 3.2rem)',
            fontWeight: 800, color: '#0f172a',
            lineHeight: 1.15, marginBottom: '20px',
            letterSpacing: '-0.02em', maxWidth: '800px', margin: '0 auto 20px',
          }}>
            Know When Services Degrade{' '}
            <span style={{ color: '#7c3aed' }}>Before Your Users Do</span>
          </h1>

          <p style={{
            fontSize: '1.15rem', color: '#374151',
            lineHeight: 1.75, maxWidth: '600px',
            margin: '0 auto 36px',
          }}>
            Real-time health monitoring, intelligent alerting, and dependency impact maps
            for every service in your AWS infrastructure. Stop reacting to incidents —
            start preventing them.
          </p>

          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '36px' }}>
            <a href="/register" style={{
              background: '#7c3aed', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
            }}>
              Monitor My Services Free →
            </a>
            <a href="/tour" style={{
              background: 'transparent', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '1.5px solid #7c3aed',
            }}>
              See How It Works
            </a>
          </div>

          <div style={{
            display: 'flex', flexWrap: 'wrap',
            justifyContent: 'center', gap: '24px',
            fontSize: '0.875rem', fontWeight: 500, color: '#374151',
          }}>
            {['Real-time health monitoring', 'Smart alert routing', 'Dependency impact maps'].map(t => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#16a34a' }}>✓</span> {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* BUSINESS IMPACT BAR */}
      <section style={{ padding: '48px', background: '#fafafa', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{
          maxWidth: '1400px', margin: '0 auto',
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '32px', textAlign: 'center',
        }}>
          {impacts.map(({ value, label }) => (
            <div key={label}>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#7c3aed', lineHeight: 1 }}>
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
      <section style={{ padding: '80px 48px', width: '100%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Health Monitoring Capabilities
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              From Reactive to Proactive in 15 Minutes
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              Stop firefighting. Start monitoring every service with the intelligence to act before users are impacted.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} style={{
                background: '#fff', border: '1.5px solid #e5e7eb',
                borderRadius: '16px', padding: '32px',
                transition: 'all 0.2s ease',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#7c3aed'
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(124,58,237,0.12)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = '#e5e7eb'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <div style={{
                  width: '48px', height: '48px', borderRadius: '12px',
                  background: 'rgba(124,58,237,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '20px',
                }}>
                  <Icon size={22} style={{ color: '#7c3aed' }} />
                </div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>
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
      <section style={{ padding: '80px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Quick Setup
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              Full Service Monitoring in 15 Minutes
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '32px' }}>
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
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', marginBottom: '12px' }}>
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

      {/* WHO IT'S FOR */}
      <section style={{ padding: '80px 48px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Built For Your Team
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              Who It&apos;s For
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '24px' }}>
            <div style={{
              background: '#fff', border: '1.5px solid #e5e7eb',
              borderRadius: '20px', padding: '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: 'rgba(124,58,237,0.08)',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For CTOs &amp; Engineering Leaders
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Protect Revenue with Proactive Monitoring
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'SLA compliance tracking across all services',
                  'Uptime reports for board and customer reporting',
                  'Reduce incident costs with faster detection',
                  'Engineering reliability metrics for investors',
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
              borderRadius: '20px', padding: '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: '#7c3aed',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For DevOps &amp; Platform Engineers
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Catch Incidents Before They Escalate
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Real-time health scores for every service',
                  'Dependency maps show downstream blast radius instantly',
                  'Smart alerts routed to the right on-call engineer',
                  'MTTR tracking to prove incident response improvement',
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
        padding: '80px 48px', textAlign: 'center',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800,
            color: '#fff', marginBottom: '16px', letterSpacing: '-0.02em',
          }}>
            Stop Firefighting. Start Preventing.
          </h2>
          <p style={{
            fontSize: '1.1rem', color: 'rgba(255,255,255,0.85)',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            Monitor every service in your AWS infrastructure and catch incidents before your users do.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/register" style={{
              background: '#fff', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
            }}>
              Start Free Trial →
            </a>
            <a href="/tour" style={{
              background: 'transparent', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.4)',
            }}>
              Take a Product Tour
            </a>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginTop: '16px' }}>
            No credit card required · Read-only AWS access · Cancel anytime
          </div>
        </div>
      </section>

    </div>
  )
}
