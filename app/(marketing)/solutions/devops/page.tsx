'use client'

import { Terminal, GitBranch, Shield, BarChart3, Zap, RefreshCw, Bell, Cloud } from 'lucide-react'
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

export default function DevOpsPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  const features = [
    { icon: GitBranch, title: 'Pipeline Visibility & DORA Metrics', desc: 'Track deployment frequency, lead time, change failure rate, and MTTR automatically from your existing GitHub setup. No instrumentation, no manual tracking — just real data.' },
    { icon: Shield, title: 'Infrastructure Drift Detection', desc: 'Know instantly when your live infrastructure diverges from your Terraform or CDK definitions. Get alerted before drift causes incidents, compliance failures, or surprise costs.' },
    { icon: Zap, title: 'AI-Powered Incident Intelligence', desc: 'When something breaks, DevControl shows you exactly what changed, which resources are affected, and the downstream blast radius — so you spend time fixing, not investigating.' },
    { icon: RefreshCw, title: 'Auto-Remediation Workflows', desc: 'Define policies that automatically fix common misconfigurations, enforce tagging standards, and right-size idle resources. Let automation handle the repetitive ops work.' },
    { icon: Bell, title: 'Smart Alert Routing', desc: 'Route the right alerts to the right people via Slack, PagerDuty, or email. Reduce alert fatigue with intelligent thresholds that learn your infrastructure\'s normal behavior.' },
    { icon: Cloud, title: 'Multi-Account AWS Control', desc: 'Manage every AWS account and region from a single dashboard. Full resource inventory, cost breakdown, and security posture across your entire cloud estate.' },
    { icon: BarChart3, title: 'Unified Observability Dashboard', desc: 'Costs, security, performance, and DORA metrics in one place. Stop switching between 6 different tools and get the full picture of your infrastructure health instantly.' },
    { icon: Terminal, title: 'Full API & CLI Access', desc: 'Integrate DevControl into your existing workflows. REST API, webhooks, and Terraform provider support let you embed infrastructure intelligence into your CI/CD pipeline.' },
  ]

  const impacts = [
    { value: '60%', label: 'Reduction in MTTR' },
    { value: '4.2hrs', label: 'Average lead time improvement' },
    { value: '15min', label: 'Setup to first insight' },
  ]

  const timeline = [
    { step: '01', title: 'Connect GitHub & AWS', time: 'Day 1', desc: 'Link your repositories and AWS accounts with read-only access. DevControl immediately starts pulling deployment events, resource changes, and cost data.' },
    { step: '02', title: 'Baseline Established', time: 'Day 1', desc: 'Your DORA metrics are calculated, infrastructure inventory is complete, and security posture score is ready — all within 15 minutes of connecting.' },
    { step: '03', title: 'Alerts & Automation Configured', time: 'Week 1', desc: 'Set up Slack alerts, configure drift detection thresholds, and define auto-remediation policies for your most common infrastructure issues.' },
    { step: '04', title: 'Full Team Onboarded', time: 'Week 2', desc: 'Every engineer has access to the dashboards they need. On-call rotations configured, runbooks linked to alerts, and DORA benchmarks shared with leadership.' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
        padding: isMobile ? '60px 20px 48px' : isTablet ? '100px 32px 72px' : '140px 48px 100px',
        borderBottom: '1px solid #1e293b',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: isMobile ? '40px' : '80px',
            alignItems: 'center',
          }}>

            {/* Left — text */}
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center',
                background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa',
                marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
              }}>
                Solutions · DevOps Teams
              </div>

              <h1 style={{
                fontSize: isMobile ? '1.9rem' : 'clamp(2rem, 4vw, 3rem)',
                fontWeight: 800, color: '#fff',
                lineHeight: 1.15, marginBottom: '20px',
                letterSpacing: '-0.02em',
              }}>
                One Dashboard for Your{' '}
                <span style={{ color: '#a78bfa' }}>Entire DevOps Stack</span>
              </h1>

              <p style={{
                fontSize: isMobile ? '1rem' : '1.1rem', color: '#94a3b8',
                lineHeight: 1.75, marginBottom: '36px',
              }}>
                Stop switching between AWS Console, Grafana, PagerDuty, and spreadsheets.
                DevControl gives DevOps teams unified visibility into costs, security,
                performance, and DORA metrics — in one place.
              </p>

              <div style={{
                display: 'flex', gap: '16px',
                flexDirection: isMobile ? 'column' : 'row',
                alignItems: isMobile ? 'stretch' : undefined,
                flexWrap: 'wrap', marginBottom: '32px',
              }}>
                <a href="/register" style={{
                  background: '#7c3aed', color: '#fff',
                  padding: '14px 32px', borderRadius: '10px',
                  fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
                  boxShadow: '0 4px 24px rgba(124,58,237,0.4)',
                  textAlign: 'center', boxSizing: 'border-box',
                }}>
                  Start Free Trial
                </a>
                <a href="/tour" style={{
                  background: 'transparent', color: '#e2e8f0',
                  padding: '14px 32px', borderRadius: '10px',
                  fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
                  border: '1.5px solid #334155',
                  textAlign: 'center', boxSizing: 'border-box',
                }}>
                  See How It Works
                </a>
              </div>

              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '20px',
                flexDirection: isMobile ? 'column' : 'row',
                fontSize: '0.875rem', fontWeight: 500, color: '#94a3b8',
              }}>
                {['GitHub & AWS integration', 'No agents required', 'Full API access'].map(t => (
                  <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ color: '#a78bfa' }}>✓</span> {t}
                  </span>
                ))}
              </div>

              <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginTop: '24px', fontStyle: 'italic' }}>
                {'DORA metrics used to take us half a day to compile for board reviews — now it\u2019s real-time and automatic. Our CTO uses it directly in QBRs.'}
              </p>
            </div>

            {/* Right — terminal block */}
            <div style={{
              background: '#0d1117',
              borderRadius: '16px',
              border: '1px solid #30363d',
              padding: '24px',
              fontFamily: 'monospace',
            }}>
              {/* Terminal header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f56' }} />
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffbd2e' }} />
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#27c93f' }} />
                <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: '#8b949e' }}>devcontrol — dashboard</span>
              </div>

              {/* Terminal content */}
              <div style={{ fontSize: isMobile ? '0.72rem' : '0.8rem', lineHeight: 2 }}>
                <div><span style={{ color: '#8b949e' }}>$</span> <span style={{ color: '#79c0ff' }}>devcontrol</span> <span style={{ color: '#e6edf3' }}>scan --account production</span></div>
                <div style={{ color: '#3fb950' }}>✓ Connected to 3 AWS accounts</div>
                <div style={{ color: '#3fb950' }}>✓ Discovered 847 resources across 6 regions</div>
                <div style={{ color: '#3fb950' }}>✓ DORA metrics calculated from 234 deployments</div>
                <div style={{ color: '#ff7b72' }}>⚠ 3 security misconfigurations found</div>
                <div style={{ color: '#ff7b72' }}>⚠ $2,400/mo in idle resources detected</div>
                <div style={{ color: '#8b949e', marginTop: '8px' }}>────────────────────────────────</div>
                <div><span style={{ color: '#8b949e' }}>Security Score:</span> <span style={{ color: '#a78bfa', fontWeight: 700 }}>87/100</span></div>
                <div><span style={{ color: '#8b949e' }}>DORA Tier:</span> <span style={{ color: '#3fb950', fontWeight: 700 }}>Elite</span></div>
                <div><span style={{ color: '#8b949e' }}>Monthly Savings:</span> <span style={{ color: '#3fb950', fontWeight: 700 }}>$2,400 identified</span></div>
                <div style={{ color: '#8b949e', marginTop: '8px' }}>────────────────────────────────</div>
                <div><span style={{ color: '#8b949e' }}>$</span> <span style={{ color: '#8b949e' }}>█</span></div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* BUSINESS IMPACT BAR */}
      <section style={{ padding: isMobile ? '32px 20px' : isTablet ? '40px 32px' : '48px', background: '#fafafa', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{
          maxWidth: '1400px', margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
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

      {/* FEATURES — grid */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px', width: '100%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              DevOps Capabilities
            </div>
            <h2 style={{
              fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              Everything Your DevOps Team Needs in One Place
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              Stop context switching. Get costs, security, performance, and DORA metrics from a single control plane.
            </p>
          </div>

          {/* Feature cards grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: '16px',
          }}>
            {features.map(({ icon: Icon, title, desc }, idx) => {
              const isFirst = idx === 0
              return (
              <div key={title} style={{
                background: isFirst ? '#faf5ff' : '#fff',
                border: isFirst ? '2px solid #7c3aed' : '1.5px solid #e5e7eb',
                borderLeft: '4px solid #7c3aed',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: isFirst ? '0 4px 24px rgba(124,58,237,0.12)' : 'none',
                transition: 'all 0.2s ease',
                position: 'relative',
              }}
                onMouseEnter={e => {
                  if (!isFirst) {
                    e.currentTarget.style.background = '#faf5ff'
                    e.currentTarget.style.boxShadow = '0 4px 20px rgba(124,58,237,0.15)'
                  }
                }}
                onMouseLeave={e => {
                  if (!isFirst) {
                    e.currentTarget.style.background = '#fff'
                    e.currentTarget.style.boxShadow = 'none'
                  }
                }}
              >
                {isFirst && (
                  <div style={{
                    position: 'absolute', top: '-12px', left: '20px',
                    background: '#7c3aed', color: '#fff',
                    fontSize: '0.7rem', fontWeight: 700,
                    padding: '3px 10px', borderRadius: '100px',
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                  }}>
                    Most Used
                  </div>
                )}
                <div style={{
                  width: '44px', height: '44px', borderRadius: '10px',
                  background: 'rgba(124,58,237,0.14)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '16px',
                }}>
                  <Icon size={20} style={{ color: '#7c3aed' }} />
                </div>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.4, marginBottom: '10px' }}>
                  {title}
                </h3>
                <p style={{ fontSize: '0.95rem', color: '#374151', lineHeight: 1.7, margin: 0 }}>
                  {desc}
                </p>
              </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — Vertical Timeline */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Onboarding Timeline
            </div>
            <h2 style={{
              fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              Fully Operational in 2 Weeks
            </h2>
          </div>

          <div style={{ maxWidth: '700px', margin: '0 auto', position: 'relative' }}>
            {/* Vertical line */}
            <div style={{
              position: 'absolute', left: '27px', top: '28px',
              width: '2px', bottom: '28px',
              background: 'linear-gradient(to bottom, #7c3aed, rgba(124,58,237,0.15))',
            }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
              {timeline.map(({ step, title, time, desc }) => (
                <div key={step} style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                  <div style={{
                    width: '56px', height: '56px', borderRadius: '50%',
                    background: '#7c3aed', color: '#fff',
                    fontSize: '0.85rem', fontWeight: 800, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '3px solid #fafafa', zIndex: 1,
                  }}>
                    {step}
                  </div>
                  <div style={{
                    background: '#fff', border: '1.5px solid #e5e7eb',
                    borderRadius: '12px', padding: isMobile ? '16px' : '20px 24px', flex: 1,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                        {title}
                      </h3>
                      <span style={{
                        fontSize: '0.75rem', fontWeight: 600, color: '#7c3aed',
                        background: 'rgba(124,58,237,0.14)', padding: '3px 10px',
                        borderRadius: '100px',
                      }}>
                        {time}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.95rem', color: '#374151', lineHeight: 1.7, margin: 0 }}>
                      {desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section style={{ padding: isMobile ? '40px 20px' : isTablet ? '52px 32px' : '64px 48px', background: '#fff' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 2fr 1fr',
            gap: isMobile ? '32px' : '48px',
            alignItems: 'center',
            background: '#faf5ff', border: '1.5px solid rgba(124,58,237,0.15)',
            borderRadius: '20px', padding: isMobile ? '28px 20px' : '48px',
          }}>
            {/* Avatar + name */}
            <div style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'column', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '72px', height: '72px', borderRadius: '50%',
                background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.5rem', fontWeight: 800, color: '#fff',
                flexShrink: 0,
              }}>
                MK
              </div>
              <div style={{ textAlign: isMobile ? 'left' : 'center' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>Marcus K.</div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Staff DevOps Engineer</div>
                <div style={{ fontSize: '0.8rem', color: '#7c3aed', fontWeight: 600 }}>Series B SaaS, 120 engineers</div>
              </div>
            </div>

            {/* Quote */}
            <div>
              <div style={{ fontSize: '2rem', color: '#a78bfa', lineHeight: 1, marginBottom: '8px' }}>&ldquo;</div>
              <p style={{ fontSize: isMobile ? '0.95rem' : '1.05rem', color: '#1e293b', lineHeight: 1.75, fontStyle: 'italic', margin: 0 }}>
                {'We went from 4 different dashboards — Grafana, Cost Explorer, SecurityHub, and a custom Notion doc — to one. Our MTTR dropped 60% in the first month because engineers stopped wasting time correlating incidents manually.'}
              </p>
              <div style={{ fontSize: '2rem', color: '#a78bfa', lineHeight: 1, textAlign: 'right', marginTop: '4px' }}>&rdquo;</div>
            </div>

            {/* Stats */}
            <div style={{
              display: 'flex',
              flexDirection: isMobile ? 'row' : 'column',
              gap: isMobile ? '16px' : '24px',
            }}>
              {[
                { value: '60%', label: 'MTTR reduction' },
                { value: '4 → 1', label: 'Dashboards consolidated' },
                { value: '15 min', label: 'Setup to first insight' },
              ].map(({ value, label }) => (
                <div key={label} style={{ textAlign: 'center', flex: isMobile ? '1' : undefined }}>
                  <div style={{ fontSize: isMobile ? '1.2rem' : '1.8rem', fontWeight: 800, color: '#7c3aed', lineHeight: 1 }}>{value}</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 500, marginTop: '4px' }}>{label}</div>
                </div>
              ))}
            </div>
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
              Built For Your Team
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
                For DevOps Engineers
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Stop Firefighting. Start Engineering.
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Unified view of costs, security, and performance',
                  'Drift detection before it causes production incidents',
                  'Smart alerts routed to the right engineer instantly',
                  'Full API access to integrate with existing workflows',
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
                For Engineering Managers
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Prove Team Performance with Real Data
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'DORA metrics show engineering velocity objectively',
                  'Cost ownership by team drives accountability',
                  'Security posture trends show continuous improvement',
                  'Executive dashboards ready for leadership reviews',
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
            One Tool. Your Entire DevOps Stack.
          </h2>
          <p style={{
            fontSize: '1.1rem', color: 'rgba(255,255,255,0.85)',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            Connect your AWS account and GitHub in 15 minutes. Get costs, security, and DORA metrics instantly.
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
              Start Free Trial
            </a>
            <a href="/tour" style={{
              background: 'transparent', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.4)',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
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
