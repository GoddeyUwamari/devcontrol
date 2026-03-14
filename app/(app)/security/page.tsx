'use client'
import { Shield, AlertTriangle, CheckSquare, ClipboardList, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export default function SecurityPage() {
  const sections = [
    { icon: AlertTriangle, label: 'Anomalies', href: '/anomalies', desc: 'Detected threats and unusual activity', count: 3, countColor: '#ef4444', bg: '#fef2f2', color: '#ef4444' },
    { icon: CheckSquare, label: 'Compliance', href: '/compliance/frameworks', desc: 'CIS, NIST, PCI-DSS, SOC 2 frameworks', count: 4, countColor: '#16a34a', bg: '#f0fdf4', color: '#16a34a' },
    { icon: ClipboardList, label: 'Audit Logs', href: '/audit-logs', desc: 'Full activity and change audit trail', count: 284, countColor: '#0ea5e9', bg: '#f0f9ff', color: '#0ea5e9' },
  ]

  const scoreItems = [
    { label: 'IAM Policies', score: 92, status: 'Pass' },
    { label: 'Network Security', score: 78, status: 'Warning' },
    { label: 'Data Encryption', score: 95, status: 'Pass' },
    { label: 'Access Logging', score: 88, status: 'Pass' },
    { label: 'Vulnerability Scanning', score: 71, status: 'Warning' },
  ]

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1400px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(124,58,237,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={20} style={{ color: '#7c3aed' }} />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>Security</h1>
        </div>
        <p style={{ color: '#6b7280', fontSize: '0.95rem', margin: 0 }}>
          Monitor your security posture, anomalies, compliance frameworks, and audit trail.
        </p>
      </div>

      {/* Security Score */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px', marginBottom: '32px' }}>
        <div style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', borderRadius: '16px', padding: '32px', textAlign: 'center', color: '#fff' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.8, marginBottom: '12px' }}>Security Score</div>
          <div style={{ fontSize: '4rem', fontWeight: 800, lineHeight: 1 }}>87</div>
          <div style={{ fontSize: '1rem', opacity: 0.8, marginBottom: '16px' }}>/100</div>
          <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: '100px', padding: '4px 12px', fontSize: '0.8rem', fontWeight: 600, display: 'inline-block' }}>
            Good · Above average
          </div>
        </div>

        <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: '16px', padding: '24px' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', marginBottom: '16px' }}>Security Checks</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {scoreItems.map(({ label, score, status }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ fontSize: '0.85rem', color: '#374151', width: '180px', flexShrink: 0 }}>{label}</div>
                <div style={{ flex: 1, height: '6px', background: '#f3f4f6', borderRadius: '100px' }}>
                  <div style={{ height: '100%', width: `${score}%`, background: status === 'Pass' ? '#16a34a' : '#f59e0b', borderRadius: '100px' }} />
                </div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#0f172a', width: '32px' }}>{score}</div>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: status === 'Pass' ? '#f0fdf4' : '#fef9c3', color: status === 'Pass' ? '#16a34a' : '#d97706' }}>{status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
        {sections.map(({ icon: Icon, label, href, desc, count, countColor, bg, color }) => (
          <Link key={href} href={href} style={{ textDecoration: 'none' }}>
            <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: '16px', padding: '28px', cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(124,58,237,0.1)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={20} style={{ color }} />
                </div>
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: countColor }}>{count}</span>
              </div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>{label}</h3>
              <p style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.6, marginBottom: '16px' }}>{desc}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.82rem', fontWeight: 600, color: '#7c3aed' }}>
                View details <ArrowRight size={12} />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
