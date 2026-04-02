'use client'

import { useState } from 'react'
import { DollarSign, Users, Shield, Network } from 'lucide-react'
import { midMarketQuickWins } from './data/midMarketQuickWins'
import { midMarketValueCards } from './data/midMarketValueCards'

const problems = [
  {
    icon: DollarSign,
    problem: 'Cloud costs growing faster than revenue — no visibility into which team is spending what',
    solution: 'Cost attribution by team and project. Automated rightsizing recommendations surface $15–40K in monthly savings on average.',
  },
  {
    icon: Users,
    problem: "Engineers stepping on each other's infrastructure — no clear ownership or RBAC",
    solution: 'Role-based access control with team namespacing. Each team owns their resources, sees their costs, manages their alerts.',
  },
  {
    icon: Shield,
    problem: 'Compliance audit in 3 months and nothing is documented',
    solution: 'Continuous SOC 2, HIPAA, and PCI-DSS scanning with auto-generated audit evidence packages — ready in one click.',
  },
  {
    icon: Network,
    problem: 'Incidents take hours to resolve because nobody knows what depends on what',
    solution: 'Auto-discovered dependency maps and change correlation show exactly what broke, what it affects, and who changed it.',
  },
]

const timeline = [
  {
    step: '01',
    title: 'Connect AWS & GitHub',
    time: 'Day 1',
    desc: 'Read-only IAM role takes 5 minutes to configure. DevControl immediately discovers all resources, pulls deployment history, and begins calculating your baseline costs and security posture.',
  },
  {
    step: '02',
    title: 'See Your Baseline',
    time: 'Day 1',
    desc: 'Within 15 minutes you have: full resource inventory, security posture score, cost breakdown by service, and DORA metrics calculated from your deployment history.',
  },
  {
    step: '03',
    title: 'Configure Teams & Alerts',
    time: 'Week 1',
    desc: 'Set up team namespaces, assign resource ownership, configure Slack alerts, and define cost budgets. Your whole org is onboarded in a day.',
  },
  {
    step: '04',
    title: 'Share with Leadership',
    time: 'Week 2',
    desc: 'Executive dashboards, compliance reports, and DORA benchmark comparisons are ready to share. Give your CTO and CFO the visibility they\'ve been asking for.',
  },
]

const pricingFeatures = [
  'Up to 500 AWS resources',
  'Unlimited team members',
  'Multi-team RBAC',
  'Cost attribution & budgets',
  'SOC 2 / HIPAA / GDPR scanning',
  'SAML SSO integration',
  'DORA metrics dashboard',
  'Auto-remediation workflows',
  'Audit logs & reporting',
  'Slack & PagerDuty integration',
  'Full API & webhook access',
  'Priority support (4hr SLA)',
]

function FeatureCard({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      style={{
        background: hovered ? '#faf5ff' : '#fff',
        border: '1.5px solid #e5e7eb',
        borderLeft: '4px solid #7c3aed',
        borderRadius: '12px',
        padding: '24px',
        transition: 'all 0.2s ease',
        boxShadow: hovered ? '0 4px 20px rgba(124,58,237,0.1)' : 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        width: '44px', height: '44px', borderRadius: '10px',
        background: 'rgba(124,58,237,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '16px',
      }}>
        <Icon size={20} style={{ color: '#7c3aed' }} />
      </div>
      <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', lineHeight: 1.4, marginBottom: '10px' }}>
        {title}
      </h3>
      <p style={{ fontSize: '0.875rem', color: '#374151', lineHeight: 1.7, margin: 0 }}>
        {desc}
      </p>
    </div>
  )
}

export default function MidMarketPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
        padding: '140px 48px 100px',
        borderBottom: '1px solid #1e293b',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '80px', alignItems: 'center' }}>

            {/* Left — text */}
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center',
                background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa',
                marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
              }}>
                Solutions · Growing Teams
              </div>

              <h1 style={{
                fontSize: 'clamp(2rem, 4vw, 3rem)',
                fontWeight: 800, color: '#fff',
                lineHeight: 1.15, marginBottom: '20px',
                letterSpacing: '-0.02em',
              }}>
                The AWS Control Plane Built for{' '}
                <span style={{ color: '#a78bfa' }}>Teams of 20–100 Engineers</span>
              </h1>

              <p style={{
                fontSize: '1.1rem', color: '#94a3b8',
                lineHeight: 1.75, marginBottom: '36px',
              }}>
                Stop managing AWS like a startup. Get the visibility, cost control, and compliance automation
                that growing engineering organizations need — without the enterprise price tag or 6-week implementation.
              </p>

              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '32px' }}>
                <a href="/register" style={{
                  background: '#7c3aed', color: '#fff',
                  padding: '14px 32px', borderRadius: '10px',
                  fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
                  boxShadow: '0 4px 24px rgba(124,58,237,0.4)',
                }}>
                  Start Free Trial
                </a>
                <a href="/contact" style={{
                  background: 'transparent', color: '#e2e8f0',
                  padding: '14px 32px', borderRadius: '10px',
                  fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
                  border: '1.5px solid #334155',
                }}>
                  Talk to Sales
                </a>
              </div>

              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '20px',
                fontSize: '0.875rem', fontWeight: 500, color: '#94a3b8',
              }}>
                {['No credit card required', 'Setup in 15 minutes', 'SOC 2 In Progress'].map(t => (
                  <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#a78bfa' }}>✓</span> {t}
                  </span>
                ))}
              </div>
            </div>

            {/* Right — metrics card */}
            <div style={{
              background: '#0d1117',
              borderRadius: '16px',
              border: '1px solid #30363d',
              padding: '32px',
            }}>
              {[
                { value: '$24K', label: 'Average monthly savings found' },
                { value: '47%', label: 'Faster incident resolution' },
                { value: '15min', label: 'Setup to first metric' },
              ].map(({ value, label }, i) => (
                <div key={label}>
                  <div style={{
                    paddingTop: i === 0 ? 0 : '24px',
                    paddingBottom: '24px',
                    borderBottom: i < 2 ? '1px solid #21262d' : 'none',
                  }}>
                    <div style={{ fontSize: '2.4rem', fontWeight: 800, color: '#a78bfa', lineHeight: 1 }}>
                      {value}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#8b949e', marginTop: '6px' }}>
                      {label}
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>
      </section>

      {/* IMPACT BAR */}
      <section style={{ padding: '48px', background: '#fafafa', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{
          maxWidth: '1400px', margin: '0 auto',
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '32px', textAlign: 'center',
        }}>
          {midMarketQuickWins.map(({ value, label }) => (
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
      <section style={{ padding: '56px 48px', width: '100%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Mid-Market Capabilities
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              Everything Growing Teams Need.{' '}
              <span style={{ display: 'block' }}>None of What They Don&apos;t.</span>
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              Purpose-built for 20–100 engineer organizations scaling their AWS footprint.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            {midMarketValueCards.map(({ icon, title, description }) => (
              <FeatureCard key={title} icon={icon} title={title} desc={description} />
            ))}
          </div>
        </div>
      </section>

      {/* PROBLEM → SOLUTION */}
      <section style={{ padding: '56px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Common Growing Pains
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              The Problems Teams Hit at 20–100 Engineers
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '24px' }}>
            {problems.map(({ icon: Icon, problem, solution }) => (
              <div key={problem} style={{
                background: '#fff',
                border: '1.5px solid #e5e7eb',
                borderRadius: '12px',
                overflow: 'hidden',
              }}>
                {/* Problem half */}
                <div style={{
                  background: '#f8fafc',
                  borderBottom: '1px solid #e5e7eb',
                  padding: '24px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{
                      width: '36px', height: '36px', borderRadius: '8px',
                      background: '#fff', border: '1px solid #e5e7eb',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Icon size={16} style={{ color: '#374151' }} />
                    </div>
                    <div>
                      <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>
                        The Problem
                      </p>
                      <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0f172a', lineHeight: 1.5, margin: 0 }}>
                        {problem}
                      </p>
                    </div>
                  </div>
                </div>
                {/* Solution half */}
                <div style={{ padding: '24px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{
                      width: '36px', height: '36px', borderRadius: '8px',
                      background: 'rgba(124,58,237,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <span style={{ fontSize: '1rem' }}>⚡</span>
                    </div>
                    <div>
                      <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>
                        DevControl Solution
                      </p>
                      <p style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6, margin: 0 }}>
                        {solution}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section style={{ padding: '40px 48px', background: '#fff' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2fr',
            gap: '0',
            border: '1.5px solid #e5e7eb',
            borderRadius: '20px',
            overflow: 'hidden',
          }}>
            {/* Left — stat column */}
            <div style={{
              background: '#7c3aed',
              padding: '48px 40px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: '32px',
            }}>
              <p style={{
                fontSize: '0.72rem', fontWeight: 700, color: 'rgba(255,255,255,0.6)',
                textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0,
              }}>
                Customer Result
              </p>
              {[
                { value: '$31K', label: 'Monthly savings found' },
                { value: '3 teams', label: 'Onboarded in one day' },
                { value: '90 days', label: 'To SOC 2 baseline' },
              ].map(({ value, label }) => (
                <div key={label}>
                  <p style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', margin: '0 0 4px', lineHeight: 1 }}>{value}</p>
                  <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.65)', margin: 0 }}>{label}</p>
                </div>
              ))}
            </div>
            {/* Right — quote */}
            <div style={{ padding: '48px', background: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <p style={{
                fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed',
                textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '20px',
              }}>
                VP Engineering · B2B SaaS · 65 Engineers
              </p>
              <p style={{
                fontSize: '1.2rem', fontWeight: 600, color: '#0f172a',
                lineHeight: 1.65, marginBottom: '28px',
              }}>
                {'\u201C'}We were flying blind across 3 AWS accounts and 4 teams. DevControl gave us full visibility in 15 minutes and found{' '}
                <span style={{ color: '#7c3aed', fontWeight: 800 }}>$31,000/month in waste we had no idea existed</span>
                {'. Our CFO now uses the cost dashboard in every board meeting.\u201D'}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '44px', height: '44px', borderRadius: '50%',
                  background: '#EDE9FE', color: '#7C3AED',
                  fontWeight: 700, fontSize: '13px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  DK
                </div>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A', margin: 0 }}>David K.</p>
                  <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>VP Engineering · B2B SaaS · 65 engineers</p>
                </div>
                <div style={{
                  marginLeft: '8px',
                  background: '#ECFDF5', color: '#059669',
                  padding: '4px 12px', borderRadius: '999px',
                  fontSize: '11px', fontWeight: 600,
                }}>
                  Saved $31K/month
                </div>
              </div>
              <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid #f1f5f9' }}>
                <a href="/case-studies" style={{
                  fontSize: '0.875rem', fontWeight: 700, color: '#7c3aed',
                  textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px',
                }}>
                  {'Read more customer stories \u2192'}
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — Vertical Timeline */}
      <section style={{ padding: '56px 48px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Onboarding Timeline
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              Operational in 2 Weeks
            </h2>
          </div>

          <div style={{ maxWidth: '700px', margin: '0 auto', position: 'relative' }}>
            {/* Vertical line */}
            <div style={{
              position: 'absolute', left: '27px', top: '28px',
              width: '2px', bottom: '28px',
              background: 'linear-gradient(to bottom, #7c3aed, rgba(124,58,237,0.1))',
            }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
              {timeline.map(({ step, title, time, desc }) => (
                <div key={step} style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                  <div style={{
                    width: '56px', height: '56px', borderRadius: '50%',
                    background: '#7c3aed', color: '#fff',
                    fontSize: '0.85rem', fontWeight: 800, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '3px solid #fff', zIndex: 1,
                  }}>
                    {step}
                  </div>
                  <div style={{
                    background: '#fff', border: '1.5px solid #e5e7eb',
                    borderRadius: '12px', padding: '20px 24px', flex: 1,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
                        {title}
                      </h3>
                      <span style={{
                        fontSize: '0.75rem', fontWeight: 600, color: '#7c3aed',
                        background: 'rgba(124,58,237,0.08)', padding: '3px 10px',
                        borderRadius: '100px',
                      }}>
                        {time}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.875rem', color: '#374151', lineHeight: 1.7, margin: 0 }}>
                      {desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section style={{ padding: '56px 48px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Transparent Pricing
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              One Plan. No Per-Seat Surprises.
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '480px', margin: '0 auto', lineHeight: 1.75 }}>
              Pay for AWS resources monitored, not team members. Add your whole org — engineers, security, finance — at no extra cost.
            </p>
          </div>

          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            <div style={{
              border: '2px solid #7c3aed',
              borderRadius: '20px',
              padding: '40px',
              boxShadow: '0 8px 40px rgba(124,58,237,0.12)',
              background: '#fff',
            }}>
              <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                <div style={{
                  fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                  textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '16px',
                }}>
                  Growth Plan
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '2.8rem', fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>$299</span>
                  <span style={{ fontSize: '1rem', color: '#94a3b8' }}>/month</span>
                </div>
                <p style={{ fontSize: '0.9rem', color: '#374151', marginTop: '8px' }}>
                  Up to 500 AWS resources · Unlimited team members
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '32px' }}>
                {pricingFeatures.map(feature => (
                  <div key={feature} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#059669', fontWeight: 700, fontSize: '1rem', flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: '0.875rem', color: '#374151' }}>{feature}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '16px' }}>
                <a href="/register" style={{
                  background: '#7c3aed', color: '#fff',
                  padding: '14px 32px', borderRadius: '10px',
                  fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
                  boxShadow: '0 4px 24px rgba(124,58,237,0.3)',
                }}>
                  Start Free Trial
                </a>
                <a href="/pricing" style={{
                  background: 'transparent', color: '#7c3aed',
                  padding: '14px 32px', borderRadius: '10px',
                  fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
                  border: '1.5px solid #7c3aed',
                }}>
                  Compare All Plans
                </a>
              </div>

              <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#94a3b8' }}>
                14-day free trial · No credit card required · Cancel anytime
              </p>
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
            Built for the Team You&apos;re Becoming
          </h2>
          <p style={{
            fontSize: '1.1rem', color: 'rgba(255,255,255,0.85)',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            Join 500+ engineering organizations using DevControl to scale faster, stay compliant, and control costs.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/register" style={{
              background: '#fff', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
            }}>
              Start Free Trial
            </a>
            <a href="/contact" style={{
              background: 'transparent', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.4)',
            }}>
              Schedule a Demo
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
