'use client'

import { useState, useEffect } from 'react'

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
import { useQuery } from '@tanstack/react-query'
import { Download, FileText, RefreshCw } from 'lucide-react'
import api from '@/lib/api'
import { InvoiceFormDialog } from '@/components/invoices/invoice-form-dialog'
import { InvoiceActions } from '@/components/invoices/invoice-actions'
import type { Invoice } from '@/lib/types'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'

function WhatYoullSee() {
  const features = [
    { icon: '📈', text: 'Track monthly spend trends' },
    { icon: '🔔', text: 'Detect unusual billing spikes' },
    { icon: '🔍', text: 'Analyze service-level costs' },
    { icon: '📄', text: 'Export detailed invoices' },
  ]
  return (
    <div style={{ marginTop: '24px', padding: '24px', background: '#F9FAFB', borderRadius: '12px', border: '1px solid #E5E7EB' }}>
      <p style={{ fontSize: '13px', fontWeight: 600, color: '#374151', margin: '0 0 16px' }}>
        Once connected, you&apos;ll be able to:
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
        {features.map(item => (
          <div key={item.text} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#4B5563' }}>
            <span>{item.icon}</span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
      <button
        style={{ background: '#7C3AED', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
        onMouseEnter={e => { e.currentTarget.style.background = '#6D28D9'; }}
        onMouseLeave={e => { e.currentTarget.style.background = '#7C3AED'; }}>
        Connect AWS Account →
      </button>
    </div>
  )
}

export default function InvoicesPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024
  const [statusFilter, setStatusFilter] = useState('all')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  // Fetch invoices using React Query
  const { data: invoices = [], isLoading, error, refetch } = useQuery({
    queryKey: ['invoices', statusFilter],
    queryFn: async () => {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const response = await api.get(`/api/billing/invoices${params}`);
      return response.data.data || [];
    },
  });

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  // AWS connection state — not connected only on explicit 401/403 auth failures
  const httpStatus: number | undefined = (error as any)?.response?.status
  const isConnected: boolean = isDemoActive ? true : httpStatus !== 401 && httpStatus !== 403

  const DEMO_INVOICES = [
    {
      id: 'inv-2026-03',
      period: 'March 2026',
      issueDate: new Date('2026-03-01'),
      dueDate: new Date('2026-03-31'),
      amount: 6847.20,
      status: 'paid',
      services: ['EC2', 'RDS', 'S3', 'Lambda'],
      downloadUrl: '#',
    },
    {
      id: 'inv-2026-02',
      period: 'February 2026',
      issueDate: new Date('2026-02-01'),
      dueDate: new Date('2026-02-28'),
      amount: 5983.50,
      status: 'paid',
      services: ['EC2', 'RDS', 'S3', 'Lambda', 'CloudFront'],
      downloadUrl: '#',
    },
    {
      id: 'inv-2026-01',
      period: 'January 2026',
      issueDate: new Date('2026-01-01'),
      dueDate: new Date('2026-01-31'),
      amount: 6124.80,
      status: 'paid',
      services: ['EC2', 'RDS', 'S3'],
      downloadUrl: '#',
    },
    {
      id: 'inv-2025-12',
      period: 'December 2025',
      issueDate: new Date('2025-12-01'),
      dueDate: new Date('2025-12-31'),
      amount: 5750.00,
      status: 'paid',
      services: ['EC2', 'RDS', 'S3', 'Lambda'],
      downloadUrl: '#',
    },
    {
      id: 'inv-2025-11',
      period: 'November 2025',
      issueDate: new Date('2025-11-01'),
      dueDate: new Date('2025-11-30'),
      amount: 5420.30,
      status: 'paid',
      services: ['EC2', 'RDS', 'S3'],
      downloadUrl: '#',
    },
    {
      id: 'inv-2025-10',
      period: 'October 2025',
      issueDate: new Date('2025-10-01'),
      dueDate: new Date('2025-10-31'),
      amount: 4998.60,
      status: 'paid',
      services: ['EC2', 'RDS', 'S3', 'CloudWatch'],
      downloadUrl: '#',
    },
  ]

  const displayInvoices = isDemoActive ? DEMO_INVOICES : (invoices || [])
  const displayError = isDemoActive ? null : error

  const totalThisMonth = isDemoActive ? 6847.20 : (displayInvoices[0]?.amount ?? 0)
  const totalPaid = isDemoActive
    ? DEMO_INVOICES.reduce((sum, inv) => sum + inv.amount, 0)
    : displayInvoices.filter((inv: any) => inv.status === 'paid').reduce((sum: number, inv: any) => sum + inv.amount, 0)
  const outstanding = isDemoActive ? 0 : displayInvoices.filter((inv: any) => inv.status === 'outstanding').reduce((sum: number, inv: any) => sum + inv.amount, 0)

  const hasData = isDemoActive || (isConnected && displayInvoices.length > 0)
  const lastMonthAmt = displayInvoices[1]?.amount ?? 0
  const momPct = !isDemoActive && lastMonthAmt > 0 && displayInvoices.length >= 2
    ? ((totalThisMonth - lastMonthAmt) / lastMonthAmt * 100)
    : null
  const DEMO_DELTAS = ['+14.4', '-2.3', '+6.5', '+6.1', '+8.4', '+7.5']

  return (
    <div style={{
      padding: isMobile ? '24px 16px' : isTablet ? '40px 24px' : '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
              {hasData ? 'Billing Intelligence' : 'Connect AWS to Unlock Billing Intelligence'}
            </h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            {hasData
              ? 'AWS invoice history, spend trends, and billing anomaly detection'
              : 'Analyze invoices, track spend trends, and detect anomalies across your AWS account.'}
          </p>
        </div>
        <button
          onClick={() => {
            if (displayInvoices.length === 0) return
            const csv = displayInvoices.map((inv: any) =>
              `${inv.period},${inv.id},${inv.amount},${inv.status}`
            ).join('\n')
            const blob = new Blob([`Period,Invoice ID,Amount,Status\n${csv}`], { type: 'text/csv' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = 'invoices.csv'; a.click()
          }}
          disabled={displayInvoices.length === 0}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: displayInvoices.length > 0 ? '#7C3AED' : 'var(--color-background-secondary, #F1F5F9)',
            color: displayInvoices.length > 0 ? '#fff' : '#9ca3af',
            padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600,
            border: displayInvoices.length > 0 ? 'none' : '0.5px solid var(--color-border-tertiary, #E5E7EB)',
            cursor: displayInvoices.length > 0 ? 'pointer' : 'not-allowed',
            opacity: displayInvoices.length > 0 ? 1 : 0.6,
          }}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      {/* 3 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2,1fr)' : 'repeat(3, 1fr)', gap: '20px', marginBottom: '28px' }}>

        {/* This Month — hero card with left accent */}
        <div style={{ background: '#fff', borderRadius: '0 14px 14px 0', padding: isMobile ? '16px 14px' : '32px', border: '1px solid #E2E8F0', borderLeft: '2px solid #534AB7' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>This Month</p>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: hasData ? '#0F172A' : '#9CA3AF', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
            {hasData ? `$${totalThisMonth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </div>
          <p style={{ fontSize: '0.78rem', color: hasData ? '#475569' : '#6B7280', margin: '0 0 6px', lineHeight: 1.6 }}>
            {hasData ? 'Current billing period' : 'No billing data available'}
          </p>
          {isDemoActive && (
            <p style={{ fontSize: '11px', color: '#A32D2D', margin: 0 }}>↑ 14.4% vs last month</p>
          )}
          {!isDemoActive && momPct !== null && (
            <p style={{ fontSize: '11px', color: momPct > 0 ? '#A32D2D' : '#3B6D11', margin: 0 }}>
              {momPct > 0 ? '↑' : '↓'} {Math.abs(momPct).toFixed(1)}% vs last month
            </p>
          )}
        </div>

        {/* Total Paid */}
        <div style={{ background: '#fff', borderRadius: '14px', padding: isMobile ? '16px 14px' : '32px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Total Paid</p>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: hasData ? '#3B6D11' : '#9CA3AF', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
            {hasData ? `$${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </div>
          <p style={{ fontSize: '0.78rem', color: hasData ? '#475569' : '#6B7280', margin: 0, lineHeight: 1.6 }}>
            {hasData ? 'All time paid invoices' : 'No billing data available'}
          </p>
        </div>

        {/* Outstanding */}
        <div style={{ background: '#fff', borderRadius: '14px', padding: isMobile ? '16px 14px' : '32px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Outstanding</p>
          <div style={{ fontSize: '2rem', fontWeight: 700, color: hasData ? (outstanding > 0 ? '#DC2626' : '#3B6D11') : '#9CA3AF', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
            {hasData ? `$${outstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </div>
          <p style={{ fontSize: '0.78rem', color: hasData ? '#475569' : '#6B7280', margin: 0, lineHeight: 1.6 }}>
            {hasData ? (outstanding > 0 ? 'Requires payment' : 'All invoices paid') : 'No billing data available'}
          </p>
        </div>

      </div>

      {/* SYNC STATUS BAR */}
      {(isConnected || isDemoActive) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8125rem', color: '#64748B', padding: '10px 0', borderBottom: '1px solid #F1F5F9', marginBottom: '20px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: displayError ? '#FBBF24' : '#22C55E', flexShrink: 0 }} />
          {displayError ? (
            <>
              <span style={{ color: '#475569' }}>Billing data sync issue · Last successful sync: unavailable · Next retry in ~5 minutes</span>
            </>
          ) : (
            <span>Billing data synced · Last updated: {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
          )}
        </div>
      )}

      {/* STATUS FILTER — hidden in state 2, collapsed in state 4 */}
      {(() => {
        const hideFilters = !isDemoActive && !isConnected
        const collapseFilters = !isDemoActive && isConnected && !displayError && displayInvoices.length === 0
        const showCount = isDemoActive || (isConnected && displayInvoices.length > 0)
        if (hideFilters) return null
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div title={!hasData ? 'Available after billing data loads' : undefined} style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px', opacity: !hasData ? 0.6 : 1, pointerEvents: !hasData ? 'none' : 'auto' }}>
              {(collapseFilters ? ['all'] : ['all', 'paid', 'outstanding', 'overdue']).map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  style={{
                    padding: '7px 18px', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 600,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s', textTransform: 'capitalize',
                    background: (statusFilter === f || (!statusFilter && f === 'all')) ? '#fff' : 'transparent',
                    color: (statusFilter === f || (!statusFilter && f === 'all')) ? '#0F172A' : '#64748B',
                    boxShadow: (statusFilter === f || (!statusFilter && f === 'all')) ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}>
                  {f === 'all' ? 'All Invoices' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            {showCount && (
              <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>
                {displayInvoices.length} invoice{displayInvoices.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )
      })()}

      {/* MAIN CONTENT — 4-state logic */}
      {isLoading && !isDemoActive ? (

        /* Loading */
        <div style={{ background: '#fff', borderRadius: '16px', padding: isMobile ? '16px 14px' : '48px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
          <RefreshCw size={24} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading invoices...</p>
        </div>

      ) : !isConnected ? (

        /* STATE 2 — Not connected */
        <>
        <div style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: '12px', padding: isMobile ? '24px 16px' : isTablet ? '40px 24px' : '64px 48px', textAlign: 'center' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <FileText size={22} style={{ color: '#94A3B8' }} />
          </div>
          <p style={{ fontSize: '15px', fontWeight: 500, color: '#0F172A', margin: '0 0 10px' }}>No billing data yet</p>
          <p style={{ fontSize: '13px', color: '#475569', margin: '0 auto 24px', maxWidth: '360px', lineHeight: 1.6 }}>
            Connect your AWS account to automatically import invoices, track spend trends, and detect billing anomalies.
          </p>
          <div style={{ margin: '0 auto 28px', maxWidth: '320px', textAlign: 'left' }}>
            {[
              'Detect unused resources and hidden costs',
              'Identify billing spikes before they compound',
              'Monthly spend trend analysis and forecasting',
            ].map(bullet => (
              <div key={bullet} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#534AB7', flexShrink: 0 }} />
                <span style={{ fontSize: '12px', color: '#475569' }}>{bullet}</span>
              </div>
            ))}
          </div>
          <button style={{ background: '#534AB7', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}>
            Connect AWS &amp; import invoices
          </button>
        </div>
        <WhatYoullSee />
        </>

      ) : isConnected && displayError && displayInvoices.length === 0 ? (

        /* STATE 3 — Error */
        <>
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#92400E', margin: '0 0 4px' }}>
                Having trouble fetching billing data
              </p>
              <p style={{ fontSize: '12px', color: '#B45309', margin: '0 0 12px', lineHeight: 1.5 }}>
                This is usually temporary. Check your AWS connection or try again.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => refetch()}
                  style={{ background: 'transparent', border: '1px solid #FCD34D', color: '#92400E', fontSize: '12px', fontWeight: 500, borderRadius: '6px', padding: '6px 14px', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#FEF3C7'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                  ↺ Retry
                </button>
                <button
                  style={{ background: 'transparent', border: '1px solid #FCD34D', color: '#92400E', fontSize: '12px', fontWeight: 500, borderRadius: '6px', padding: '6px 14px', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#FEF3C7'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                  Reconnect AWS
                </button>
              </div>
            </div>
          </div>
          <WhatYoullSee />
        </>

      ) : isConnected && !displayError && displayInvoices.length === 0 ? (

        /* STATE 4 — Connected, no invoices yet */
        <>
        <div style={{ background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: '12px', padding: isMobile ? '24px 16px' : isTablet ? '40px 24px' : '64px 48px', textAlign: 'center' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <FileText size={22} style={{ color: '#94A3B8' }} />
          </div>
          <p style={{ fontSize: '15px', fontWeight: 500, color: '#0F172A', margin: '0 0 10px' }}>No invoices yet</p>
          <p style={{ fontSize: '13px', color: '#475569', margin: '0 auto 0', maxWidth: '360px', lineHeight: 1.6 }}>
            Your AWS account is connected. Invoices will appear here after your first billing cycle completes — typically within 24–48 hours.
          </p>
        </div>
        <WhatYoullSee />
        </>

      ) : (

        /* HAS DATA — demo or real invoices */
        <>
          {/* CHANGE 7 — Spend anomaly banner (demo only) */}
          {isDemoActive && (
            <div style={{ background: '#FAEEDA', border: '0.5px solid #BA7517', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#EF9F27', flexShrink: 0, marginTop: '3px' }} />
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 500, color: '#633806', margin: '0 0 4px' }}>Spend anomaly detected</p>
                  <p style={{ fontSize: '12px', color: '#854F0B', margin: 0, lineHeight: 1.5 }}>
                    March billing increased 14.4% vs February (+$863.70). Possible cause: EC2 scaling or new service activation.
                  </p>
                </div>
              </div>
              <button style={{ background: '#fff', border: '0.5px solid #BA7517', color: '#633806', fontSize: '11px', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: '16px', flexShrink: 0 }}>
                Investigate →
              </button>
            </div>
          )}

          {/* Invoice table */}
          <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden', overflowX: isMobile ? 'auto' : 'hidden' }}>
            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 160px 160px 120px 100px 120px', gap: '0', padding: '12px 28px', borderBottom: '1px solid #F1F5F9', background: '#F8FAFC' }}>
              {['Billing Period', 'Invoice ID', 'Issue Date', 'Amount', 'VS Prior Month', 'Status', 'Actions'].map(col => (
                <span key={col} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</span>
              ))}
            </div>

            {/* Invoice rows */}
            {displayInvoices.map((inv: any, idx: number) => {
              const isPaid = inv.status === 'paid'
              const isOutstanding = inv.status === 'outstanding'
              const statusColor = isPaid ? '#059669' : isOutstanding ? '#D97706' : '#DC2626'
              const statusBg    = isPaid ? '#F0FDF4' : isOutstanding ? '#FFFBEB' : '#FEF2F2'
              const statusLabel = isPaid ? 'Paid' : isOutstanding ? 'Outstanding' : 'Overdue'

              // VS PRIOR MONTH delta
              let deltaEl
              if (isDemoActive) {
                const raw = DEMO_DELTAS[idx]
                const isPos = raw.startsWith('+')
                deltaEl = (
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: isPos ? '#A32D2D' : '#3B6D11' }}>
                    {isPos ? '↑' : '↓'} {raw.replace(/[+-]/, '')}%
                  </span>
                )
              } else {
                const nextInv = displayInvoices[idx + 1]
                if (!nextInv) {
                  deltaEl = <span style={{ fontSize: '0.82rem', color: '#9ca3af' }}>—</span>
                } else {
                  const pct = ((inv.amount - nextInv.amount) / nextInv.amount * 100)
                  const isPos = pct >= 0
                  deltaEl = (
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: isPos ? '#A32D2D' : '#3B6D11' }}>
                      {isPos ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%
                    </span>
                  )
                }
              }

              return (
                <div
                  key={inv.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 140px 160px 160px 120px 100px 120px',
                    gap: '0',
                    padding: '16px 28px',
                    borderBottom: idx < displayInvoices.length - 1 ? '1px solid #F8FAFC' : 'none',
                    alignItems: 'center',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#F8FAFC' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                >
                  {/* Period */}
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>
                      {inv.period || inv.invoiceNumber || inv.id?.substring(0, 8)}
                    </p>
                    {inv.services && (
                      <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>
                        {inv.services.slice(0, 3).join(', ')}{inv.services.length > 3 ? ` +${inv.services.length - 3}` : ''}
                      </p>
                    )}
                    {inv.tenantName && !inv.services && (
                      <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>{inv.tenantName}</p>
                    )}
                  </div>

                  {/* Invoice ID */}
                  <span style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: '#64748B' }}>{inv.id}</span>

                  {/* Issue Date */}
                  <span style={{ fontSize: '0.82rem', color: '#475569' }}>
                    {inv.issueDate
                      ? new Date(inv.issueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : inv.dueDate
                      ? formatDate(inv.dueDate)
                      : '—'}
                  </span>

                  {/* Amount */}
                  <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>
                    {formatCurrency(inv.amount ?? inv.totalAmount ?? 0)}
                  </span>

                  {/* VS Prior Month */}
                  {deltaEl}

                  {/* Status */}
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '100px', background: statusBg, color: statusColor, width: 'fit-content' }}>
                    {statusLabel}
                  </span>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {isDemoActive ? (
                      <button
                        onClick={() => window.open(inv.downloadUrl || '#', '_blank')}
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '5px 10px', fontSize: '0.75rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
                        <Download size={11} /> PDF
                      </button>
                    ) : (
                      <InvoiceActions invoice={inv as Invoice} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <InvoiceFormDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  )
}
