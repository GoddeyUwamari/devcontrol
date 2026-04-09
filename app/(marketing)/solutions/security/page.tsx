'use client'

import { useEffect, useState } from 'react'
import { Shield, AlertTriangle, CheckCircle2, Lock, Eye, FileText } from 'lucide-react'

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

export default function SecurityCompliancePage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  const features = [
    { icon: Shield, title: 'Continuous Security Scanning', desc: 'Automated scans across all AWS resources 24/7. Every misconfiguration, exposed port, and policy violation surfaced instantly — no manual audits required.' },
    { icon: AlertTriangle, title: 'Real-time Threat Alerts', desc: 'Instant notifications when security posture changes. Catch open S3 buckets, overpermissioned IAM roles, and unencrypted resources before attackers do.' },
    { icon: FileText, title: 'SOC 2 & HIPAA Compliance', desc: 'Automated compliance monitoring mapped to SOC 2, HIPAA, and CIS benchmarks. Know your compliance posture in real time — not just at audit time.' },
    { icon: Lock, title: 'IAM Policy Analysis', desc: 'Deep analysis of every IAM role, policy, and permission. Identify over-privileged users, unused credentials, and toxic permission combinations automatically.' },
    { icon: Eye, title: 'Risk Score & Trends', desc: 'A single security score for your entire AWS estate. Track improvement over time and benchmark against industry standards with weekly trend reports.' },
    { icon: CheckCircle2, title: 'Audit-Ready Reports', desc: 'One-click compliance reports for your auditors, board, or enterprise customers. Export evidence packages that prove your security posture instantly.' },
  ]

  const impacts = [
    { value: '87/100', label: 'Average security score after 30 days' },
    { value: '90%+', label: 'Reduction in manual audit prep time' },
    { value: '2 weeks', label: 'Average time to identify all SOC 2 gaps' },
  ]

  const steps = [
    { step: '01', title: 'Connect Your AWS Account', desc: 'Read-only IAM access. DevControl immediately begins scanning your entire infrastructure for security misconfigurations.' },
    { step: '02', title: 'Get Your Security Score', desc: 'Within minutes you have a complete security posture report — every finding ranked by severity with remediation guidance.' },
    { step: '03', title: 'Remediate & Monitor', desc: 'Fix issues with guided remediation steps. Continuous monitoring ensures your security posture never silently degrades.' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #fff 100%)',
        padding: isMobile ? '48px 16px' : isTablet ? '64px 32px' : '80px 48px',
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
            Platform · Security & Compliance
          </div>

          <h1 style={{
            fontSize: isMobile ? 'clamp(1.8rem,5vw,2.6rem)' : 'clamp(2.2rem,5vw,3.2rem)',
            fontWeight: 800, color: '#0f172a',
            lineHeight: 1.15, marginBottom: '20px',
            letterSpacing: '-0.02em', maxWidth: '800px', margin: '0 auto 20px',
          }}>
            Know Your Security Posture{' '}
            <span style={{ color: '#7c3aed' }}>Before Your Auditors Do</span>
          </h1>

          <p style={{
            fontSize: isMobile ? '0.95rem' : '1.15rem', color: '#374151',
            lineHeight: 1.75, maxWidth: '600px',
            margin: '0 auto 36px',
          }}>
            Continuous AWS security scanning, real-time compliance monitoring, and
            audit-ready reports — so you're never caught off guard by a finding or a breach.
          </p>

          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: '16px',
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginBottom: '36px',
            alignItems: 'center',
          }}>
            <a href="/register" style={{
              background: '#7c3aed', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
              width: isMobile ? '100%' : undefined,
              textAlign: 'center',
              boxSizing: 'border-box',
            }}>
              Scan My AWS Security Free
            </a>
            <a href="/tour" style={{
              background: 'transparent', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '1.5px solid #7c3aed',
              width: isMobile ? '100%' : undefined,
              textAlign: 'center',
              boxSizing: 'border-box',
            }}>
              See How It Works
            </a>
          </div>

          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: isMobile ? '10px' : '24px',
            fontSize: '0.875rem', fontWeight: 500, color: '#374151',
            alignItems: 'center',
          }}>
            {['SOC 2 & HIPAA monitoring', 'Continuous 24/7 scanning', 'Audit-ready in 2 weeks'].map(t => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#16a34a' }}>✓</span> {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* BUSINESS IMPACT BAR */}
      <section style={{
        padding: isMobile ? '32px 16px' : isTablet ? '40px 32px' : '48px',
        background: '#fafafa', borderBottom: '1px solid #f3f4f6',
      }}>
        <div style={{
          maxWidth: '1400px', margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
          gap: '32px', textAlign: 'center',
        }}>
          {impacts.map(({ value, label }) => (
            <div key={label}>
              <div style={{ fontSize: isMobile ? '1.8rem' : '2.5rem', fontWeight: 800, color: '#7c3aed', lineHeight: 1 }}>
                {value}
              </div>
              <div style={{ fontSize: isMobile ? '0.82rem' : '0.9rem', color: '#374151', fontWeight: 500, marginTop: '8px' }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section style={{ padding: isMobile ? '48px 16px' : isTablet ? '64px 32px' : '80px 48px', width: '100%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: isMobile ? '32px' : '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Security Capabilities
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              Enterprise-Grade Security, Without the Enterprise Complexity
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              Everything your security team needs to stay ahead of threats and sail through audits.
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gap: '24px',
          }}>
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} style={{
                background: '#fff', border: '1.5px solid #e5e7eb',
                borderRadius: '16px', padding: isMobile ? '20px' : '32px',
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
                <h3 style={{ fontSize: isMobile ? '0.95rem' : '1.05rem', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>
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
      <section style={{ padding: isMobile ? '48px 16px' : isTablet ? '64px 32px' : '80px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: isMobile ? '32px' : '56px' }}>
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
              Audit-Ready in 2 Weeks
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
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

      {/* SOCIAL PROOF */}
      <section style={{
        padding: isMobile ? '40px 16px' : isTablet ? '48px 32px' : '64px 48px',
        background: '#fff',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            background: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
            borderRadius: '20px',
            padding: isMobile ? '24px 20px' : '48px 56px',
            border: '1px solid rgba(124,58,237,0.15)',
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            gap: isMobile ? '24px' : '48px',
            alignItems: 'center',
          }}>
            <div>
              <p style={{
                fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed',
                textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '16px',
              }}>
                Customer Result
              </p>
              <p style={{
                fontSize: isMobile ? '1rem' : '1.3rem', fontWeight: 700, color: '#0f172a',
                lineHeight: 1.5, marginBottom: '20px',
              }}>
                {'"The security compliance dashboard caught a misconfigured S3 bucket before our SOC 2 audit — that alone was worth it."'}
              </p>
              <p style={{ fontSize: '0.875rem', color: '#475569', marginBottom: '24px' }}>
                Alex K. · Infrastructure Lead · Growth-stage startup
              </p>
              <div style={{
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                gap: isMobile ? '16px' : '32px',
              }}>
                {[
                  { value: 'Passed', label: 'SOC 2 audit clean' },
                  { value: '15 min', label: 'Time to first security score' },
                  { value: '0', label: 'Audit findings missed' },
                ].map(({ value, label }) => (
                  <div key={label}>
                    <p style={{ fontSize: isMobile ? '1.1rem' : '1.4rem', fontWeight: 800, color: '#7c3aed', margin: '0 0 2px' }}>{value}</p>
                    <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>{label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {[
                { icon: '🔍', step: 'Day 1', body: 'Connected AWS in 8 minutes. DevControl immediately surfaced 14 security findings across IAM, S3, and network configuration.' },
                { icon: '⚠️', step: 'Day 3', body: 'AI flagged a publicly accessible S3 bucket containing customer data — caught before the SOC 2 auditor review.' },
                { icon: '✅', step: 'Week 2', body: 'All critical findings resolved. Compliance dashboard used as live evidence during SOC 2 audit. Passed clean.' },
              ].map(({ icon, step, body }) => (
                <div key={step} style={{
                  background: '#fff',
                  borderRadius: '12px',
                  padding: isMobile ? '16px' : '20px 24px',
                  border: '1px solid #E2E8F0',
                  display: 'flex',
                  gap: '14px',
                  alignItems: 'flex-start',
                }}>
                  <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>{icon}</span>
                  <div>
                    <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>{step}</p>
                    <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.6 }}>{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section style={{ padding: isMobile ? '48px 16px' : isTablet ? '64px 32px' : '80px 48px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: isMobile ? '32px' : '56px' }}>
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
              {"Who It's For"}
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
            gap: '24px',
          }}>
            <div style={{
              background: '#fff', border: '1.5px solid #e5e7eb',
              borderRadius: '20px', padding: isMobile ? '24px 20px' : '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: 'rgba(124,58,237,0.08)',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For CTOs & Compliance Officers
              </div>
              <h3 style={{ fontSize: isMobile ? '1.1rem' : '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Always Audit-Ready
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Real-time SOC 2 compliance monitoring dashboard',
                  'One-click audit evidence packages for customers',
                  'Board-level security posture reporting',
                  'Reduce breach risk with continuous scanning',
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
              borderRadius: '20px', padding: isMobile ? '24px 20px' : '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: '#7c3aed',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For Security & DevOps Engineers
              </div>
              <h3 style={{ fontSize: isMobile ? '1.1rem' : '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Fix Misconfigurations Before They Become Incidents
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Every IAM misconfiguration flagged automatically',
                  'Open S3 buckets and exposed resources caught instantly',
                  'CIS benchmark compliance tracked continuously',
                  'Guided remediation steps for every finding',
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
        padding: isMobile ? '48px 24px' : isTablet ? '64px 32px' : '80px 48px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800,
            color: '#fff', marginBottom: '16px', letterSpacing: '-0.02em',
          }}>
            Your Next Security Audit Starts Today
          </h2>
          <p style={{
            fontSize: isMobile ? '0.95rem' : '1.1rem', color: 'rgba(255,255,255,0.85)',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            Get your AWS security score in 15 minutes. No agents, no code changes, no risk.
          </p>
          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: '16px',
            justifyContent: 'center',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}>
            <a href="/register" style={{
              background: '#fff', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              width: isMobile ? '100%' : undefined,
              textAlign: 'center',
              boxSizing: 'border-box',
            }}>
              Start Free Trial
            </a>
            <a href="/tour" style={{
              background: 'transparent', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.4)',
              width: isMobile ? '100%' : undefined,
              textAlign: 'center',
              boxSizing: 'border-box',
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
