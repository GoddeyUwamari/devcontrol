'use client'

import { Shield, Lock, Users, BarChart3, Zap, FileText, Globe, Headphones } from 'lucide-react'
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

export default function EnterprisePage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  const features = [
    { icon: Shield, title: 'Custom Compliance Frameworks', desc: 'Map your infrastructure to any compliance standard — SOC 2, HIPAA, PCI-DSS, ISO 27001, or your own internal security policies. Automated evidence collection for every audit.' },
    { icon: Lock, title: 'SSO & SAML Authentication', desc: 'Integrate with Okta, Azure AD, or any SAML 2.0 provider. Role-based access control ensures every engineer sees only what they need to see.' },
    { icon: Users, title: 'Unlimited Team Members', desc: 'No per-seat pricing surprises. Add your entire engineering org, security team, and finance stakeholders — all with customized role-based dashboards.' },
    { icon: Globe, title: 'Multi-Account & Multi-Region', desc: 'Manage hundreds of AWS accounts across every region from a single control plane. Consolidate visibility across business units, products, and geographies.' },
    { icon: BarChart3, title: 'Advanced AI Insights', desc: 'Scheduled AI reports delivered weekly to your leadership team. Custom anomaly detection rules, predictive cost forecasting, and executive-ready dashboards built in.' },
    { icon: FileText, title: 'Auto-Remediation Workflows', desc: 'Go beyond alerts. Define automated remediation policies that fix misconfigurations, enforce tagging, and right-size resources — without human intervention.' },
    { icon: Zap, title: 'Full API Access', desc: 'Integrate DevControl data into your existing BI tools, security platforms, and internal dashboards. REST API with full documentation and SDK support.' },
    { icon: Headphones, title: 'Dedicated Account Manager', desc: '24/7 priority support with a named account manager who knows your infrastructure. 99.99% uptime SLA backed by contractual guarantees.' },
  ]

  const impacts = [
    { value: '99.99%', label: 'Uptime SLA guaranteed' },
    { value: 'Unlimited', label: 'AWS accounts supported' },
    { value: '24/7', label: 'Priority support response' },
    { value: 'Custom', label: 'Compliance framework mapping' },
  ]

  const tableRows = [
    { feature: 'AWS Accounts', enterprise: 'Unlimited', pro: 'Up to 10' },
    { feature: 'Team Members', enterprise: 'Unlimited', pro: 'Up to 10' },
    { feature: 'SSO / SAML', enterprise: '✓', pro: '\u2014' },
    { feature: 'Custom Compliance', enterprise: '✓', pro: '\u2014' },
    { feature: 'Auto-Remediation', enterprise: '✓', pro: '\u2014' },
    { feature: 'Dedicated Account Manager', enterprise: '✓', pro: '\u2014' },
    { feature: 'SLA Guarantee', enterprise: '99.99%', pro: '99.9%' },
    { feature: 'Support', enterprise: '24/7 Priority', pro: '4hr Response' },
    { feature: 'API Access', enterprise: 'Full', pro: 'Limited' },
    { feature: 'Custom Integrations', enterprise: '✓', pro: '\u2014' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO — Dark Navy */}
      <section style={{
        width: '100%',
        background: '#0f172a',
        padding: isMobile ? '60px 20px' : isTablet ? '80px 32px' : '100px 48px',
        borderBottom: '1px solid #1e293b',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', textAlign: 'center' }}>

          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
            borderRadius: '100px', padding: '6px 16px',
            fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa',
            marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Solutions · Enterprise
          </div>

          <h1 style={{
            fontSize: isMobile ? '1.9rem' : 'clamp(2.2rem, 5vw, 3.5rem)',
            fontWeight: 800, color: '#fff',
            lineHeight: 1.1, marginBottom: '20px',
            letterSpacing: '-0.02em', maxWidth: '900px', margin: '0 auto 20px',
          }}>
            Enterprise-Grade AWS Control{' '}
            <span style={{ color: '#a78bfa' }}>Without Enterprise Complexity</span>
          </h1>

          <p style={{
            fontSize: isMobile ? '1rem' : '1.15rem', color: '#94a3b8',
            lineHeight: 1.75, maxWidth: '620px',
            margin: '0 auto 36px',
          }}>
            Unlimited accounts, custom compliance frameworks, SSO, auto-remediation,
            and a dedicated account manager. Everything a large engineering org needs
            to govern AWS at scale — deployed in days, not months.
          </p>

          <div style={{
            display: 'flex', gap: '16px', justifyContent: 'center',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'center' : undefined,
            flexWrap: 'wrap', marginBottom: '36px',
          }}>
            <a href="/contact" style={{
              background: '#7c3aed', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              boxShadow: '0 4px 24px rgba(124,58,237,0.4)',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              Schedule Enterprise Demo
            </a>
            <a href="/case-studies" style={{
              background: 'transparent', color: '#e2e8f0',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '1.5px solid #334155',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              Read Case Studies
            </a>
          </div>

          <div style={{
            display: 'flex', flexWrap: 'wrap',
            justifyContent: 'center', gap: isMobile ? '12px' : '24px',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: 'center',
            fontSize: '0.875rem', fontWeight: 500, color: '#94a3b8',
          }}>
            {['SOC 2 In Progress', 'SAML / SSO', '99.99% SLA', 'Dedicated support'].map(t => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#a78bfa' }}>✓</span> {t}
              </span>
            ))}
          </div>
          <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginTop: '24px', fontStyle: 'italic' }}>
            {'A global SaaS company managing 120+ AWS services identified $1.2M in annual savings within 30 days of deploying DevControl Enterprise.'}
          </p>
        </div>
      </section>

      {/* BUSINESS IMPACT BAR */}
      <section style={{ padding: isMobile ? '32px 20px' : isTablet ? '40px 32px' : '48px', background: '#fafafa', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{
          maxWidth: '1400px', margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          gap: isMobile ? '20px' : '32px', textAlign: 'center',
        }}>
          {impacts.map(({ value, label }) => (
            <div key={label}>
              <div style={{ fontSize: isMobile ? '1.4rem' : '2rem', fontWeight: 800, color: '#7c3aed', lineHeight: 1 }}>
                {value}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#1f2937', fontWeight: 500, marginTop: '8px' }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES — 2 col alternating */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px', width: '100%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Enterprise Capabilities
            </div>
            <h2 style={{
              fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 700,
              color: '#1e1b4b', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              Built for Large Engineering Organizations
            </h2>
            <p style={{ fontSize: '1.1rem', color: '#1f2937', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              Every feature your security, finance, and engineering teams need to govern AWS at enterprise scale.
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
            gap: '20px',
          }}>
            {features.map(({ icon: Icon, title, desc }, i) => (
              <div key={title} style={{
                background: i % 2 === 0 ? '#fff' : '#faf5ff',
                border: i % 2 === 0 ? '1.5px solid #e5e7eb' : '1.5px solid rgba(124,58,237,0.15)',
                borderRadius: '16px', padding: isMobile ? '24px' : '32px',
                display: 'flex', gap: '20px', alignItems: 'flex-start',
                transition: 'all 0.2s ease',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#7c3aed'
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(124,58,237,0.15)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = i % 2 === 0 ? '#e5e7eb' : 'rgba(124,58,237,0.15)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <div style={{
                  width: '48px', height: '48px', borderRadius: '12px',
                  background: 'rgba(124,58,237,0.14)', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={22} style={{ color: '#7c3aed' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e1b4b', marginBottom: '8px' }}>
                    {title}
                  </h3>
                  <p style={{ fontSize: '0.9rem', color: '#1f2937', lineHeight: 1.75 }}>
                    {desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section style={{ padding: isMobile ? '40px 20px' : isTablet ? '52px 32px' : '64px 48px', background: '#0f172a' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <p style={{
            fontSize: '0.72rem', fontWeight: 700, color: '#a78bfa',
            textTransform: 'uppercase', letterSpacing: '0.12em',
            textAlign: 'center', marginBottom: '48px',
          }}>
            What Enterprise Teams Say
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gap: isMobile ? '32px' : '40px',
          }}>
            {[
              {
                quote: 'Our CTO checks the security compliance dashboard before every investor call. It caught a misconfigured S3 bucket before our SOC 2 audit.',
                name: 'Alex K.',
                title: 'Infrastructure Lead',
                company: 'Growth-stage startup',
                outcome: 'Passed SOC 2 clean',
              },
              {
                quote: 'We manage 47 AWS accounts across 3 business units. DevControl gave us unified visibility in a single afternoon. The multi-account support is exceptional.',
                name: 'Rachel T.',
                title: 'VP Platform Engineering',
                company: 'Enterprise SaaS · 400 engineers',
                outcome: '47 accounts unified',
              },
              {
                quote: 'The auto-remediation workflows eliminated an entire class of compliance violations. What used to take our security team a week now happens automatically.',
                name: 'Michael S.',
                title: 'Head of Cloud Security',
                company: 'Series D Fintech',
                outcome: '90% reduction in manual remediation',
              },
            ].map(({ quote, name, title, company, outcome }) => (
              <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <p style={{
                  fontSize: '0.95rem', color: '#e2e8f0',
                  lineHeight: 1.75, fontStyle: 'italic',
                }}>
                  {'\u201C'}{quote}{'\u201D'}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: 'auto', flexWrap: 'wrap' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '50%',
                    background: 'rgba(124,58,237,0.3)', color: '#a78bfa',
                    fontWeight: 700, fontSize: '12px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {name.split(' ').map((n: string) => n[0]).join('')}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#fff', margin: 0 }}>{name}</p>
                    <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>{title} · {company}</p>
                  </div>
                  <div style={{
                    marginLeft: 'auto',
                    background: 'rgba(124,58,237,0.2)', color: '#a78bfa',
                    padding: '3px 10px', borderRadius: '999px',
                    fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap',
                  }}>
                    {outcome}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMPARISON TABLE */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Enterprise vs Pro
            </div>
            <h2 style={{
              fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 700,
              color: '#1e1b4b', letterSpacing: '-0.02em',
            }}>
              What Enterprise Teams Get
            </h2>
          </div>

          <div style={{ maxWidth: '800px', margin: '0 auto', overflowX: 'auto' }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr 100px 100px' : '1fr 160px 160px',
              background: '#0f172a', borderRadius: '12px 12px 0 0',
              padding: isMobile ? '14px 16px' : '16px 24px',
            }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#94a3b8' }}>Feature</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#a78bfa', textAlign: 'center' }}>Enterprise</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#94a3b8', textAlign: 'center' }}>Pro</div>
            </div>

            {/* Table rows */}
            {tableRows.map(({ feature, enterprise, pro }, i) => (
              <div key={feature} style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr 100px 100px' : '1fr 160px 160px',
                padding: isMobile ? '12px 16px' : '14px 24px',
                background: i % 2 === 0 ? '#fff' : '#f8fafc',
                borderLeft: '1px solid #e5e7eb',
                borderRight: '1px solid #e5e7eb',
                borderBottom: i === tableRows.length - 1 ? '1px solid #e5e7eb' : '1px solid #f1f5f9',
                borderRadius: i === tableRows.length - 1 ? '0 0 12px 12px' : '0',
              }}>
                <div style={{ fontSize: isMobile ? '0.8rem' : '0.875rem', color: '#1f2937', fontWeight: 500 }}>{feature}</div>
                <div style={{
                  fontSize: isMobile ? '0.8rem' : '0.875rem', fontWeight: 700,
                  color: enterprise === '✗' ? '#9ca3af' : '#7c3aed',
                  textAlign: 'center',
                }}>
                  {enterprise}
                </div>
                <div style={{
                  fontSize: isMobile ? '0.8rem' : '0.875rem', fontWeight: 500,
                  color: pro === '\u2014' ? '#9ca3af' : '#1f2937',
                  textAlign: 'center',
                }}>
                  {pro}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BOTTOM CTA — Inverted (white bg, dark text) */}
      <section style={{
        width: '100%',
        background: '#fff',
        padding: isMobile ? '56px 20px' : isTablet ? '64px 32px' : '80px 48px',
        textAlign: 'center',
        borderTop: '1px solid #f3f4f6',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(124,58,237,0.2)',
            borderRadius: '100px', padding: '6px 16px',
            fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
            marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Ready to Scale with DevControl
          </div>
          <h2 style={{
            fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 700,
            color: '#1e1b4b', marginBottom: '16px', letterSpacing: '-0.02em',
          }}>
            Let&apos;s Talk About Your Infrastructure
          </h2>
          <p style={{
            fontSize: '1.1rem', color: '#1f2937',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            Our enterprise team will walk you through a custom deployment plan,
            security review, and ROI projection for your organization.
          </p>
          <div style={{
            display: 'flex', gap: '16px', justifyContent: 'center',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'center' : undefined,
            flexWrap: 'wrap',
          }}>
            <a href="/contact" style={{
              background: '#7c3aed', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              Schedule Enterprise Demo
            </a>
            <a href="/case-studies" style={{
              background: 'transparent', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '1.5px solid #7c3aed',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              Read Case Studies
            </a>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '16px' }}>
            Custom pricing · Dedicated onboarding · Contract SLA
          </div>
        </div>
      </section>

    </div>
  )
}
