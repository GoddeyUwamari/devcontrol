'use client'

import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'

// ── Static demo values ────────────────────────────────────────────────────────
const DEMO_STATS = {
  totalServices:      8,
  criticalDeps:       3,
  customerFacing:     2,
  circularDeps:       0,
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ServiceDependenciesPage() {
  const demoMode     = useDemoMode()
  const salesDemo    = useSalesDemo((s) => s.enabled)
  const isDemoActive = demoMode || salesDemo

  const stats = isDemoActive ? DEMO_STATS : DEMO_STATS // live data TBD

  const { totalServices, criticalDeps, customerFacing, circularDeps } = stats

  // ── Status bar ─────────────────────────────────────────────────────────────
  let statusIcon = '✅'
  let statusMsg  = 'All systems operational · No critical dependency risks detected'
  if (circularDeps > 0) {
    statusIcon = '🔴'
    statusMsg  = `${circularDeps} circular ${circularDeps === 1 ? 'dependency' : 'dependencies'} detected · These can cause cascading failures`
  } else if (criticalDeps > 0) {
    statusIcon = '⚠️'
    statusMsg  = `${criticalDeps} critical dependency ${criticalDeps === 1 ? 'path' : 'paths'} detected · Highest risk: Auth → Payment → Email Queue`
  }

  // ── KPI cards ──────────────────────────────────────────────────────────────
  const kpiCards = [
    {
      label:      'Total Services',
      value:      totalServices,
      sub:        'In dependency map',
      valueColor: '#0F172A',
      badge:      null,
    },
    {
      label:      'Critical Dependencies',
      value:      criticalDeps,
      sub:        'Affecting: Checkout, Auth flows',
      valueColor: criticalDeps > 0 ? '#DC2626' : '#059669',
      badge:      criticalDeps > 0 ? { text: 'High Risk', bg: '#FEF2F2', color: '#DC2626' } : null,
    },
    {
      label:      'Customer Facing',
      value:      customerFacing,
      sub:        'API & frontend services',
      valueColor: '#7C3AED',
      badge:      null,
    },
    {
      label:      'Circular Deps',
      value:      circularDeps,
      sub:        circularDeps > 0 ? 'Cascading risk detected' : 'No cycles detected',
      valueColor: circularDeps > 0 ? '#DC2626' : '#059669',
      badge:      null,
    },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      padding: '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Service Dependency Map
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Visualize and analyze service relationships, critical paths, and failure blast radius
          </p>
        </div>
      </div>

      {/* STATUS BAR */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        background: circularDeps > 0 ? '#FEF2F2' : criticalDeps > 0 ? '#FFFBEB' : '#F0FDF4',
        border: `1px solid ${circularDeps > 0 ? '#FECACA' : criticalDeps > 0 ? '#FDE68A' : '#BBF7D0'}`,
        borderRadius: '8px', padding: '10px 16px', marginBottom: '24px',
        fontSize: '0.82rem', color: circularDeps > 0 ? '#991B1B' : criticalDeps > 0 ? '#92400E' : '#166534',
      }}>
        <span>{statusIcon}</span>
        <span>{statusMsg}</span>
      </div>

      {/* KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {kpiCards.map(({ label, value, sub, valueColor, badge }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '28px', border: '1px solid #E2E8F0' }}>
            <p style={{ fontSize: '0.68rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px' }}>{label}</p>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '6px' }}>{value}</div>
            <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 6px', lineHeight: 1.5 }}>{sub}</p>
            {badge && (
              <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: badge.bg, color: badge.color }}>
                {badge.text}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
