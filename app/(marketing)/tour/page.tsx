'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Lock, Shield, DollarSign, BarChart2, Activity, Search, Zap } from 'lucide-react'

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

// ─── Mock screens ────────────────────────────────────────────────────────────

function IAMMock() {
  const steps = [
    { label: 'Create IAM role in AWS console', status: 'done' },
    { label: 'Attach read-only policy', status: 'done' },
    { label: 'Scanning your account resources…', status: 'active' },
    { label: 'Generating insights dashboard', status: 'pending' },
  ]
  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6b7280', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Connection Progress
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700,
                background: s.status === 'done' ? '#16a34a' : s.status === 'active' ? '#7c3aed' : '#f3f4f6',
                color: s.status === 'pending' ? '#9ca3af' : '#fff',
                border: s.status === 'active' ? '2px solid rgba(124,58,237,0.3)' : 'none',
                animation: s.status === 'active' ? 'spin 1.5s linear infinite' : 'none',
              }}>
                {s.status === 'done' ? '✓' : s.status === 'active' ? '◌' : i + 1}
              </div>
              <span style={{
                fontSize: '0.83rem', fontWeight: 500,
                color: s.status === 'pending' ? '#9ca3af' : s.status === 'active' ? '#7c3aed' : '#0f172a',
              }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)',
        borderRadius: '8px', padding: '10px 14px', marginTop: '16px',
      }}>
        <Lock size={13} style={{ color: '#16a34a', flexShrink: 0 }} />
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#15803d' }}>
          Read-Only Access — We can never modify your AWS resources
        </span>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function CostsMock() {
  const metrics = [
    { label: 'AWS Spend', value: '$1,247', sub: 'this month', color: '#0f172a' },
    { label: 'Projected', value: '$1,890', sub: 'end of month', color: '#f59e0b' },
    { label: 'Savings Found', value: '$2,400', sub: 'per month', color: '#16a34a' },
    { label: 'Services', value: '23', sub: 'monitored', color: '#7c3aed' },
  ]
  const bars = [60, 80, 55, 90, 70, 85, 45]
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
        {metrics.map((m) => (
          <div key={m.label} style={{ background: '#f9fafb', borderRadius: '10px', padding: '12px 14px', border: '1px solid #f3f4f6' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {m.label}
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: m.color, lineHeight: 1 }}>{m.value}</div>
            <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '2px' }}>{m.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#6b7280', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Daily Spend
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '60px' }}>
        {bars.map((h, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
            <div style={{
              width: '100%', borderRadius: '4px 4px 0 0',
              height: `${h}%`,
              background: i === 5 ? '#7c3aed' : 'rgba(124,58,237,0.2)',
            }} />
            <span style={{ fontSize: '0.6rem', color: '#9ca3af' }}>{labels[i]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AIMock() {
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
        <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '10px', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#b45309', background: 'rgba(245,158,11,0.15)', padding: '2px 7px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cost Alert</span>
          </div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0f172a', marginBottom: '3px' }}>EC2 spend up 34% this week</div>
          <div style={{ fontSize: '0.75rem', color: '#374151', lineHeight: 1.5 }}>
            3 new t3.large instances in us-east-1 were launched Tuesday and are running idle 80% of the time. Estimated waste: $340/month.
          </div>
        </div>
        <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#b91c1c', background: 'rgba(239,68,68,0.12)', padding: '2px 7px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Security</span>
          </div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0f172a', marginBottom: '3px' }}>2 S3 buckets are publicly accessible</div>
          <div style={{ fontSize: '0.75rem', color: '#374151', lineHeight: 1.5 }}>
            Buckets <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: '3px', fontSize: '0.7rem' }}>logs-prod</code> and <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: '3px', fontSize: '0.7rem' }}>assets-staging</code> have public ACLs. Fix in one click.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px' }}>
        <Search size={13} style={{ color: '#9ca3af', flexShrink: 0 }} />
        <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>Ask anything — "Why did my bill increase in May?"</span>
      </div>
    </div>
  )
}

function SecurityMock() {
  const items = [
    { label: 'IAM Root Access Keys', status: 'pass' },
    { label: 'MFA Enabled', status: 'pass' },
    { label: 'S3 Public Access', status: 'fail' },
    { label: 'CloudTrail Logging', status: 'pass' },
    { label: 'Security Groups', status: 'warn' },
    { label: 'RDS Encryption', status: 'pass' },
  ]
  const statusColor = { pass: '#16a34a', warn: '#f59e0b', fail: '#ef4444' }
  const statusBg = { pass: 'rgba(22,163,74,0.08)', warn: 'rgba(245,158,11,0.08)', fail: 'rgba(239,68,68,0.08)' }
  const statusLabel = { pass: 'Pass', warn: 'Warn', fail: 'Fail' }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
        <div style={{ position: 'relative', width: '64px', height: '64px', flexShrink: 0 }}>
          <svg viewBox="0 0 64 64" style={{ width: '64px', height: '64px', transform: 'rotate(-90deg)' }}>
            <circle cx="32" cy="32" r="26" fill="none" stroke="#f3f4f6" strokeWidth="6" />
            <circle cx="32" cy="32" r="26" fill="none" stroke="#7c3aed" strokeWidth="6"
              strokeDasharray={`${2 * Math.PI * 26 * 0.87} ${2 * Math.PI * 26}`}
              strokeLinecap="round" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0f172a' }}>87</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>Security Score</div>
          <div style={{ fontSize: '0.75rem', color: '#374151', marginTop: '2px' }}>4 passing · 1 warning · 1 critical</div>
          <div style={{ fontSize: '0.7rem', color: '#7c3aed', fontWeight: 600, marginTop: '4px' }}>↑ +5 from last week</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        {items.map((item) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb', borderRadius: '8px', padding: '8px 10px', gap: '6px' }}>
            <span style={{ fontSize: '0.73rem', fontWeight: 500, color: '#374151' }}>{item.label}</span>
            <span style={{
              fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px',
              color: statusColor[item.status as keyof typeof statusColor],
              background: statusBg[item.status as keyof typeof statusBg],
            }}>
              {statusLabel[item.status as keyof typeof statusLabel]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DoraMock() {
  const metrics = [
    { label: 'Deployment Frequency', value: '4.2/day', badge: 'Elite', badgeColor: '#16a34a', badgeBg: 'rgba(22,163,74,0.1)', trend: '↑ +0.8 vs last week' },
    { label: 'Lead Time for Changes', value: '2.1 hrs', badge: 'Elite', badgeColor: '#16a34a', badgeBg: 'rgba(22,163,74,0.1)', trend: '↓ −0.4 hrs' },
    { label: 'Change Failure Rate', value: '3.2%', badge: 'High', badgeColor: '#7c3aed', badgeBg: 'rgba(124,58,237,0.1)', trend: '↓ −0.5%' },
    { label: 'MTTR', value: '24 min', badge: 'Elite', badgeColor: '#16a34a', badgeBg: 'rgba(22,163,74,0.1)', trend: '↓ −6 min' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
      {metrics.map((m) => (
        <div key={m.label} style={{ background: '#f9fafb', borderRadius: '10px', padding: '14px', border: '1px solid #f3f4f6' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.label}</span>
            <span style={{ fontSize: '0.6rem', fontWeight: 700, color: m.badgeColor, background: m.badgeBg, padding: '2px 6px', borderRadius: '4px' }}>
              {m.badge}
            </span>
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>{m.value}</div>
          <div style={{ fontSize: '0.68rem', color: m.badgeColor, fontWeight: 600, marginTop: '4px' }}>{m.trend}</div>
        </div>
      ))}
    </div>
  )
}

function ActionsMock() {
  const actions = [
    { title: 'Terminate 3 idle EC2 instances', desc: 'Running at <5% CPU for 14+ days in us-east-1', savings: '$340/mo', severity: 'warn' },
    { title: 'Right-size RDS db.r5.2xlarge', desc: 'Memory usage consistently under 20%', savings: '$180/mo', severity: 'info' },
    { title: 'Block public S3 bucket access', desc: 'logs-prod has public read ACL enabled', savings: 'Security', severity: 'fail' },
  ]
  const severityColor = { warn: '#f59e0b', info: '#7c3aed', fail: '#ef4444' }
  const severityBg = { warn: 'rgba(245,158,11,0.08)', info: 'rgba(124,58,237,0.06)', fail: 'rgba(239,68,68,0.06)' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {actions.map((a, i) => (
        <div key={i} style={{
          background: severityBg[a.severity as keyof typeof severityBg],
          border: `1px solid ${severityColor[a.severity as keyof typeof severityColor]}33`,
          borderRadius: '10px', padding: '12px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '2px' }}>{a.title}</div>
            <div style={{ fontSize: '0.72rem', color: '#374151', lineHeight: 1.4 }}>{a.desc}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: a.severity === 'fail' ? '#ef4444' : '#16a34a' }}>
              {a.savings}
            </span>
            <button style={{
              background: '#7c3aed', color: '#fff', border: 'none',
              padding: '5px 12px', borderRadius: '6px',
              fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}>
              Fix Now
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── MockScreen wrapper ───────────────────────────────────────────────────────

function MockScreen({ type }: { type: string }) {
  const urlMap: Record<string, string> = {
    iam: 'onboarding',
    costs: 'costs',
    ai: 'ai-insights',
    security: 'security',
    dora: 'dora-metrics',
    actions: 'recommendations',
  }
  return (
    <div style={{
      background: '#fff', borderRadius: '16px',
      border: '1px solid #e5e7eb',
      boxShadow: '0 8px 40px rgba(0,0,0,0.10)',
      overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div style={{
        background: '#f9fafb', borderBottom: '1px solid #e5e7eb',
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '6px',
      }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e' }} />
        <div style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px',
          padding: '4px 12px', fontSize: '0.72rem', color: '#6b7280',
          marginLeft: '8px', flex: 1, maxWidth: '240px',
        }}>
          devcontrol.app/{urlMap[type] ?? type}
        </div>
      </div>
      {/* Body */}
      <div style={{ padding: '20px' }}>
        {type === 'iam'      && <IAMMock />}
        {type === 'costs'    && <CostsMock />}
        {type === 'ai'       && <AIMock />}
        {type === 'security' && <SecurityMock />}
        {type === 'dora'     && <DoraMock />}
        {type === 'actions'  && <ActionsMock />}
      </div>
    </div>
  )
}

// ─── Steps data ───────────────────────────────────────────────────────────────

const steps = [
  {
    eyebrow: 'Step 1 — Setup',
    title: 'Connect your AWS account in 2 minutes',
    description: 'Deploy a read-only IAM role with one click. We never store credentials and can never modify your infrastructure.',
    highlights: [
      'Read-only IAM role — zero write access ever',
      'Works across all AWS accounts and regions',
      'No agents, no code changes required',
      'AES-256 encrypted in transit and at rest',
    ],
    mockType: 'iam',
    navLabel: 'Connect AWS',
  },
  {
    eyebrow: 'Step 2 — Cost Visibility',
    title: 'See exactly where your AWS money goes',
    description: 'Get instant visibility into your AWS spend across all services, accounts, and regions. No more surprise bills.',
    highlights: [
      'Real-time cost breakdown by service',
      'Month-over-month trend analysis',
      'Idle and unused resource detection',
      'Average team saves $2,400/month',
    ],
    mockType: 'costs',
    navLabel: 'Cost Overview',
  },
  {
    eyebrow: 'Step 3 — AI Intelligence',
    title: 'AI that explains your infrastructure in plain English',
    description: 'Get weekly AI summaries, cost anomaly alerts, and natural language answers about your AWS environment.',
    highlights: [
      'Weekly AI briefings delivered to your inbox',
      'Ask questions in plain English — no SQL',
      'Anomaly detection with root cause analysis',
      'AI-generated cost optimization reports',
    ],
    mockType: 'ai',
    navLabel: 'AI Insights',
  },
  {
    eyebrow: 'Step 4 — Security & Compliance',
    title: 'Know your security posture instantly',
    description: 'Automated security scanning across all AWS resources. Track SOC 2, HIPAA, and PCI compliance posture without manual audits.',
    highlights: [
      'Continuous compliance monitoring',
      'SOC 2, HIPAA, PCI DSS frameworks',
      'One-click remediation suggestions',
      'Audit-ready reports on demand',
    ],
    mockType: 'security',
    navLabel: 'Security Scan',
  },
  {
    eyebrow: 'Step 5 — Engineering Performance',
    title: 'Track DORA metrics automatically',
    description: 'See deployment frequency, lead time, change failure rate, and MTTR — without spreadsheets or manual tracking.',
    highlights: [
      'All 4 DORA metrics tracked automatically',
      'Compare against industry benchmarks',
      'Filter by team, service, environment',
      'Export CSV and PDF reports',
    ],
    mockType: 'dora',
    navLabel: 'DORA Metrics',
  },
  {
    eyebrow: 'Step 6 — Take Action',
    title: 'Fix issues and optimize with one click',
    description: "DevControl doesn't just surface problems — it tells you exactly what to do and helps you do it safely.",
    highlights: [
      'One-click cost optimization actions',
      'Guided remediation for security issues',
      'All actions logged and reversible',
      'Team notifications via Slack + PagerDuty',
    ],
    mockType: 'actions',
    navLabel: 'Take Action',
  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TourPage() {
  const [currentStep, setCurrentStep] = useState(0)
  const totalSteps = 6
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* Hero */}
      <section style={{
        background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #fff 100%)',
        padding: isMobile ? '48px 24px 40px' : isTablet ? '60px 32px 48px' : '80px 48px 60px',
        textAlign: 'center',
        borderBottom: '1px solid #f3f4f6',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)',
          borderRadius: '100px', padding: '6px 16px',
          fontSize: '0.78rem', fontWeight: 600, color: '#7c3aed',
          marginBottom: '24px', letterSpacing: '0.04em', textTransform: 'uppercase',
        }}>
          ⚡ Interactive Product Tour · 3 minutes · No signup needed
        </div>

        <h1 style={{
          fontSize: isMobile ? 'clamp(1.8rem, 4vw, 2.4rem)' : 'clamp(2rem, 4vw, 3rem)', fontWeight: 800,
          color: '#0f172a', lineHeight: 1.15, marginBottom: '16px',
          letterSpacing: '-0.02em',
        }}>
          See <span style={{ color: '#7c3aed' }}>DevControl</span> in Action
        </h1>

        <p style={{
          fontSize: isMobile ? '0.95rem' : '1.1rem', color: '#374151', lineHeight: 1.7,
          maxWidth: '520px', margin: '0 auto',
        }}>
          Walk through 6 steps to see how engineering teams get complete
          AWS visibility in under 15 minutes.
        </p>
      </section>

      {/* Progress bar */}
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: isMobile ? '24px 16px 0' : isTablet ? '32px 32px 0' : '48px 48px 0' }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: '0',
          marginBottom: '48px',
        }}>
          {steps.map((step, i) => (
            <div
              key={i}
              onClick={() => setCurrentStep(i)}
              style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: '8px',
                cursor: 'pointer', flex: 1, position: 'relative',
              }}
            >
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div style={{
                  position: 'absolute', top: '16px',
                  left: 'calc(50% + 16px)', right: 'calc(-50% + 16px)',
                  height: '2px',
                  background: i < currentStep ? '#7c3aed' : '#e5e7eb',
                  transition: 'background 0.3s ease',
                }} />
              )}

              {/* Step circle */}
              <div style={{
                width: isMobile ? '28px' : '32px', height: isMobile ? '28px' : '32px', borderRadius: '50%',
                background: i <= currentStep ? '#7c3aed' : '#f3f4f6',
                color: i <= currentStep ? '#fff' : '#6b7280',
                fontSize: '0.8rem', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: i <= currentStep ? '2px solid #7c3aed' : '2px solid #e5e7eb',
                boxShadow: i === currentStep ? '0 0 0 4px rgba(124,58,237,0.15)' : 'none',
                transition: 'all 0.3s ease',
                position: 'relative', zIndex: 1,
              }}>
                {i < currentStep ? '✓' : i + 1}
              </div>

              {/* Step label */}
              {!isMobile && (
                <div style={{
                  fontSize: '0.72rem', fontWeight: 600,
                  color: i === currentStep ? '#7c3aed' : i < currentStep ? '#374151' : '#9ca3af',
                  textAlign: 'center', letterSpacing: '0.02em',
                }}>
                  {step.navLabel}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: isMobile ? '0 16px 48px' : isTablet ? '0 32px 64px' : '0 48px 80px' }}>

        {/* Step counter */}
        <div style={{
          textAlign: 'center', fontSize: '0.8rem',
          color: '#9ca3af', fontWeight: 500, marginBottom: isMobile ? '20px' : '32px',
        }}>
          Step <span style={{ color: '#7c3aed', fontWeight: 700 }}>{currentStep + 1}</span> of {totalSteps}
        </div>

        {/* Two-column layout */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile || isTablet ? '1fr' : '1fr 1.4fr',
          gap: isMobile ? '24px' : isTablet ? '32px' : '48px',
          alignItems: 'center',
        }}>
          {/* LEFT — Step info */}
          <div>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px',
            }}>
              {steps[currentStep].eyebrow}
            </div>

            <h2 style={{
              fontSize: isMobile ? '1.4rem' : isTablet ? '1.6rem' : '1.8rem', fontWeight: 800, color: '#0f172a',
              lineHeight: 1.2, marginBottom: '16px', letterSpacing: '-0.02em',
            }}>
              {steps[currentStep].title}
            </h2>

            <p style={{
              fontSize: isMobile ? '0.9rem' : '1rem', color: '#374151',
              lineHeight: 1.7, marginBottom: '24px',
            }}>
              {steps[currentStep].description}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '32px' }}>
              {steps[currentStep].highlights.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: '#7c3aed', marginTop: '7px', flexShrink: 0,
                  }} />
                  <span style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>{h}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — Mock screen */}
          <MockScreen type={steps[currentStep].mockType} />
        </div>

        {/* Prev / Next */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: isMobile ? '28px' : '40px', paddingTop: '32px',
          borderTop: '1px solid #f3f4f6',
        }}>
          <button
            onClick={() => setCurrentStep(s => Math.max(0, s - 1))}
            style={{
              visibility: currentStep === 0 ? 'hidden' : 'visible',
              background: 'transparent', color: '#374151',
              border: '1.5px solid #e5e7eb', padding: isMobile ? '10px 18px' : '12px 24px',
              borderRadius: '10px', fontWeight: 600, fontSize: isMobile ? '0.82rem' : '0.9rem',
              cursor: 'pointer',
            }}
          >
            ← Previous
          </button>

          <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
            {currentStep + 1} of {totalSteps} steps
          </span>

          {currentStep < totalSteps - 1 ? (
            <button
              onClick={() => setCurrentStep(s => Math.min(totalSteps - 1, s + 1))}
              style={{
                background: '#7c3aed', color: '#fff', border: 'none',
                padding: isMobile ? '10px 18px' : '12px 28px', borderRadius: '10px',
                fontWeight: 700, fontSize: isMobile ? '0.82rem' : '0.9rem', cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}
            >
              Next Step
            </button>
          ) : (
            <Link href="/register" style={{
              background: '#7c3aed', color: '#fff',
              padding: isMobile ? '10px 18px' : '12px 28px', borderRadius: '10px',
              fontWeight: 700, fontSize: isMobile ? '0.82rem' : '0.9rem',
              textDecoration: 'none', display: 'flex',
              alignItems: 'center', gap: '8px',
              boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
            }}>
              🚀 Get Started Free
            </Link>
          )}
        </div>
      </div>

      {/* Final CTA */}
      <section style={{
        background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
        padding: isMobile ? '48px 24px' : isTablet ? '64px 32px' : '80px 48px', textAlign: 'center',
      }}>
        <h2 style={{
          fontSize: isMobile ? '1.6rem' : isTablet ? '2rem' : '2.2rem', fontWeight: 800, color: '#fff',
          marginBottom: '16px', letterSpacing: '-0.02em',
        }}>
          Your AWS bill is too high. Let&apos;s fix that.
        </h2>
        <p style={{
          fontSize: isMobile ? '0.95rem' : '1.1rem', color: 'rgba(255,255,255,0.85)',
          maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
        }}>
          Join 500+ engineering teams saving an average of $2,400/month with DevControl.
        </p>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '16px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href="/register" style={{
            background: '#fff', color: '#7c3aed',
            padding: '14px 32px', borderRadius: '10px',
            fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
            width: isMobile ? '100%' : 'auto', textAlign: 'center',
          }}>
            Start Free Trial
          </Link>
          <Link href="/contact" style={{
            background: 'transparent', color: '#fff',
            padding: '14px 32px', borderRadius: '10px',
            fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
            border: '2px solid rgba(255,255,255,0.4)',
            width: isMobile ? '100%' : 'auto', textAlign: 'center',
          }}>
            Talk to Sales
          </Link>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginTop: '16px' }}>
          No credit card required · 14-day free trial · Read-only AWS access
        </div>
      </section>

    </div>
  )
}
