'use client'

import { useState } from 'react'
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
    <div className="mt-6 p-6 bg-slate-50 rounded-xl border border-slate-200">
      <p className="text-xs font-semibold text-slate-700 mb-4">Once connected, you&apos;ll be able to:</p>
      <div className="grid grid-cols-2 gap-2.5 mb-5">
        {features.map(item => (
          <div key={item.text} className="flex items-center gap-2 text-xs text-slate-600">
            <span>{item.icon}</span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
      <button className="bg-violet-600 hover:bg-violet-700 text-white border-none rounded-lg px-4 py-2.5 text-xs font-semibold cursor-pointer transition-colors">
        Connect AWS Account →
      </button>
    </div>
  )
}

const DEMO_INVOICES = [
  { id: 'inv-2026-03', period: 'March 2026', issueDate: new Date('2026-03-01'), dueDate: new Date('2026-03-31'), amount: 6847.20, status: 'paid', services: ['EC2', 'RDS', 'S3', 'Lambda'], downloadUrl: '#' },
  { id: 'inv-2026-02', period: 'February 2026', issueDate: new Date('2026-02-01'), dueDate: new Date('2026-02-28'), amount: 5983.50, status: 'paid', services: ['EC2', 'RDS', 'S3', 'Lambda', 'CloudFront'], downloadUrl: '#' },
  { id: 'inv-2026-01', period: 'January 2026', issueDate: new Date('2026-01-01'), dueDate: new Date('2026-01-31'), amount: 6124.80, status: 'paid', services: ['EC2', 'RDS', 'S3'], downloadUrl: '#' },
  { id: 'inv-2025-12', period: 'December 2025', issueDate: new Date('2025-12-01'), dueDate: new Date('2025-12-31'), amount: 5750.00, status: 'paid', services: ['EC2', 'RDS', 'S3', 'Lambda'], downloadUrl: '#' },
  { id: 'inv-2025-11', period: 'November 2025', issueDate: new Date('2025-11-01'), dueDate: new Date('2025-11-30'), amount: 5420.30, status: 'paid', services: ['EC2', 'RDS', 'S3'], downloadUrl: '#' },
  { id: 'inv-2025-10', period: 'October 2025', issueDate: new Date('2025-10-01'), dueDate: new Date('2025-10-31'), amount: 4998.60, status: 'paid', services: ['EC2', 'RDS', 'S3', 'CloudWatch'], downloadUrl: '#' },
]
const DEMO_DELTAS = ['+14.4', '-2.3', '+6.5', '+6.1', '+8.4', '+7.5']

export default function InvoicesPage() {
  const [statusFilter, setStatusFilter] = useState('all')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const { data: invoices = [], isLoading, error, refetch } = useQuery({
    queryKey: ['invoices', statusFilter],
    queryFn: async () => {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const response = await api.get(`/api/billing/invoices${params}`);
      return response.data.data || [];
    },
  });

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  const httpStatus: number | undefined = (error as any)?.response?.status
  const isConnected: boolean = isDemoActive ? true : httpStatus !== 401 && httpStatus !== 403

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
    ? ((totalThisMonth - lastMonthAmt) / lastMonthAmt * 100) : null

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* ── PAGE HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1">
            {hasData ? 'Billing Intelligence' : 'Connect AWS to Unlock Billing Intelligence'}
          </h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            {hasData
              ? 'AWS invoice history, spend trends, and billing anomaly detection'
              : 'Analyze invoices, track spend trends, and detect anomalies across your AWS account.'}
          </p>
        </div>
        <button
          onClick={() => {
            if (displayInvoices.length === 0) return
            const csv = displayInvoices.map((inv: any) => `${inv.period},${inv.id},${inv.amount},${inv.status}`).join('\n')
            const blob = new Blob([`Period,Invoice ID,Amount,Status\n${csv}`], { type: 'text/csv' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href = url; a.download = 'invoices.csv'; a.click()
          }}
          disabled={displayInvoices.length === 0}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors whitespace-nowrap shrink-0 w-fit ${
            displayInvoices.length > 0
              ? 'bg-violet-600 hover:bg-violet-700 text-white border-transparent cursor-pointer'
              : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60'
          }`}>
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* ── 3 KPI CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-7">
        <div className="bg-white rounded-r-xl p-5 sm:p-8 border border-slate-200 border-l-[3px] border-l-violet-600">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">This Month</p>
          <div className={`text-2xl sm:text-3xl font-bold tracking-tight leading-none mb-2 ${hasData ? 'text-slate-900' : 'text-slate-300'}`}>
            {hasData ? `$${totalThisMonth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </div>
          <p className={`text-xs leading-relaxed mb-1 ${hasData ? 'text-slate-500' : 'text-slate-400'}`}>
            {hasData ? 'Current billing period' : 'No billing data available'}
          </p>
          {isDemoActive && <p className="text-[11px] text-red-600 font-medium">↑ 14.4% vs last month</p>}
          {!isDemoActive && momPct !== null && (
            <p className={`text-[11px] font-medium ${momPct > 0 ? 'text-red-600' : 'text-green-700'}`}>
              {momPct > 0 ? '↑' : '↓'} {Math.abs(momPct).toFixed(1)}% vs last month
            </p>
          )}
        </div>
        <div className="bg-white rounded-xl p-5 sm:p-8 border border-slate-200">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Total Paid</p>
          <div className={`text-2xl sm:text-3xl font-bold tracking-tight leading-none mb-2 ${hasData ? 'text-green-700' : 'text-slate-300'}`}>
            {hasData ? `$${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </div>
          <p className={`text-xs leading-relaxed ${hasData ? 'text-slate-500' : 'text-slate-400'}`}>
            {hasData ? 'All time paid invoices' : 'No billing data available'}
          </p>
        </div>
        <div className="bg-white rounded-xl p-5 sm:p-8 border border-slate-200">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Outstanding</p>
          <div className={`text-2xl sm:text-3xl font-bold tracking-tight leading-none mb-2 ${!hasData ? 'text-slate-300' : outstanding > 0 ? 'text-red-600' : 'text-green-700'}`}>
            {hasData ? `$${outstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
          </div>
          <p className={`text-xs leading-relaxed ${hasData ? 'text-slate-500' : 'text-slate-400'}`}>
            {hasData ? (outstanding > 0 ? 'Requires payment' : 'All invoices paid') : 'No billing data available'}
          </p>
        </div>
      </div>

      {/* ── SYNC STATUS ── */}
      {(isConnected || isDemoActive) && (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-2.5 border-b border-slate-100 mb-5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${displayError ? 'bg-amber-400' : 'bg-green-500'}`} />
          {displayError
            ? 'Billing data sync issue · Last successful sync: unavailable · Next retry in ~5 minutes'
            : `Billing data synced · Last updated: ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
        </div>
      )}

      {/* ── FILTER TABS ── */}
      {(() => {
        const hideFilters = !isDemoActive && !isConnected
        const collapseFilters = !isDemoActive && isConnected && !displayError && displayInvoices.length === 0
        const showCount = isDemoActive || (isConnected && displayInvoices.length > 0)
        if (hideFilters) return null
        return (
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <div className={`flex bg-slate-50 rounded-lg p-1 gap-0.5 overflow-x-auto ${!hasData ? 'opacity-60 pointer-events-none' : ''}`}>
              {(collapseFilters ? ['all'] : ['all', 'paid', 'outstanding', 'overdue']).map(f => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`px-4 py-1.5 rounded-md text-xs font-semibold border-none cursor-pointer transition-all whitespace-nowrap ${
                    statusFilter === f ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500'
                  }`}>
                  {f === 'all' ? 'All Invoices' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            {showCount && <p className="text-xs text-slate-400 m-0">{displayInvoices.length} invoice{displayInvoices.length !== 1 ? 's' : ''}</p>}
          </div>
        )
      })()}

      {/* ── MAIN CONTENT ── */}
      {isLoading && !isDemoActive ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100">
          <RefreshCw size={22} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading invoices...</p>
        </div>

      ) : !isConnected ? (
        <>
          <div className="bg-white border border-slate-100 rounded-2xl p-8 sm:p-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-5">
              <FileText size={22} className="text-slate-400" />
            </div>
            <p className="text-base font-medium text-slate-900 mb-2.5">No billing data yet</p>
            <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed mb-6">
              Connect your AWS account to automatically import invoices, track spend trends, and detect billing anomalies.
            </p>
            <div className="max-w-xs mx-auto text-left mb-7">
              {['Detect unused resources and hidden costs', 'Identify billing spikes before they compound', 'Monthly spend trend analysis and forecasting'].map(bullet => (
                <div key={bullet} className="flex items-center gap-2 mb-2">
                  <span className="w-1 h-1 rounded-full bg-violet-600 shrink-0" />
                  <span className="text-xs text-slate-500">{bullet}</span>
                </div>
              ))}
            </div>
            <button className="bg-violet-700 hover:bg-violet-800 text-white border-none rounded-lg px-5 py-2.5 text-sm font-semibold cursor-pointer transition-colors">
              Connect AWS &amp; import invoices
            </button>
          </div>
          <WhatYoullSee />
        </>

      ) : isConnected && displayError && displayInvoices.length === 0 ? (
        <>
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-5 flex items-start gap-3">
            <span className="text-base shrink-0 mt-0.5">⚠️</span>
            <div className="flex-1">
              <p className="text-xs font-semibold text-amber-900 mb-1">Having trouble fetching billing data</p>
              <p className="text-xs text-amber-700 leading-relaxed mb-3">This is usually temporary. Check your AWS connection or try again.</p>
              <div className="flex gap-2">
                <button onClick={() => refetch()} className="bg-transparent border border-amber-300 text-amber-900 text-xs font-medium rounded-lg px-3.5 py-1.5 cursor-pointer hover:bg-amber-100 transition-colors">↺ Retry</button>
                <button className="bg-transparent border border-amber-300 text-amber-900 text-xs font-medium rounded-lg px-3.5 py-1.5 cursor-pointer hover:bg-amber-100 transition-colors">Reconnect AWS</button>
              </div>
            </div>
          </div>
          <WhatYoullSee />
        </>

      ) : isConnected && !displayError && displayInvoices.length === 0 ? (
        <>
          <div className="bg-white border border-slate-100 rounded-2xl p-8 sm:p-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-5">
              <FileText size={22} className="text-slate-400" />
            </div>
            <p className="text-base font-medium text-slate-900 mb-2.5">No invoices yet</p>
            <p className="text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
              Your AWS account is connected. Invoices will appear here after your first billing cycle completes — typically within 24–48 hours.
            </p>
          </div>
          <WhatYoullSee />
        </>

      ) : (
        <>
          {/* Anomaly banner */}
          {isDemoActive && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3.5 sm:p-4 mb-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="flex gap-2.5 items-start">
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                <div>
                  <p className="text-xs font-medium text-amber-900 mb-1">Spend anomaly detected</p>
                  <p className="text-xs text-amber-700 leading-relaxed">March billing increased 14.4% vs February (+$863.70). Possible cause: EC2 scaling or new service activation.</p>
                </div>
              </div>
              <button className="bg-white border border-amber-300 text-amber-900 text-xs rounded-lg px-3 py-1.5 cursor-pointer whitespace-nowrap shrink-0 self-start">Investigate →</button>
            </div>
          )}

          {/* Invoice table — desktop */}
          <div className="hidden sm:block bg-white rounded-2xl border border-slate-100 overflow-hidden">
            <div className="grid grid-cols-[1fr_140px_160px_160px_120px_100px_120px] px-7 py-3 border-b border-slate-100 bg-slate-50">
              {['Billing Period', 'Invoice ID', 'Issue Date', 'Amount', 'VS Prior Month', 'Status', 'Actions'].map(col => (
                <span key={col} className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{col}</span>
              ))}
            </div>
            {displayInvoices.map((inv: any, idx: number) => {
              const isPaid = inv.status === 'paid', isOutstanding = inv.status === 'outstanding'
              const statusClass = isPaid ? 'bg-green-50 text-green-700' : isOutstanding ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
              const statusLabel = isPaid ? 'Paid' : isOutstanding ? 'Outstanding' : 'Overdue'
              let deltaEl
              if (isDemoActive) {
                const raw = DEMO_DELTAS[idx], isPos = raw.startsWith('+')
                deltaEl = <span className={`text-xs font-semibold ${isPos ? 'text-red-600' : 'text-green-700'}`}>{isPos ? '↑' : '↓'} {raw.replace(/[+-]/, '')}%</span>
              } else {
                const nextInv = displayInvoices[idx + 1]
                if (!nextInv) { deltaEl = <span className="text-xs text-slate-300">—</span> }
                else {
                  const pct = ((inv.amount - nextInv.amount) / nextInv.amount * 100), isPos = pct >= 0
                  deltaEl = <span className={`text-xs font-semibold ${isPos ? 'text-red-600' : 'text-green-700'}`}>{isPos ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%</span>
                }
              }
              return (
                <div key={inv.id} className={`grid grid-cols-[1fr_140px_160px_160px_120px_100px_120px] px-7 py-4 items-center hover:bg-slate-50 transition-colors ${idx < displayInvoices.length - 1 ? 'border-b border-slate-50' : ''}`}>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 mb-0.5">{inv.period || inv.invoiceNumber || inv.id?.substring(0, 8)}</p>
                    {inv.services && <p className="text-[10px] text-slate-400">{inv.services.slice(0, 3).join(', ')}{inv.services.length > 3 ? ` +${inv.services.length - 3}` : ''}</p>}
                    {inv.tenantName && !inv.services && <p className="text-[10px] text-slate-400">{inv.tenantName}</p>}
                  </div>
                  <span className="text-xs font-mono text-slate-500">{inv.id}</span>
                  <span className="text-xs text-slate-500">{inv.issueDate ? new Date(inv.issueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : inv.dueDate ? formatDate(inv.dueDate) : '—'}</span>
                  <span className="text-sm font-bold text-slate-900">{formatCurrency(inv.amount ?? inv.totalAmount ?? 0)}</span>
                  {deltaEl}
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full w-fit ${statusClass}`}>{statusLabel}</span>
                  <div className="flex gap-2">
                    {isDemoActive ? (
                      <button onClick={() => window.open(inv.downloadUrl || '#', '_blank')} className="flex items-center gap-1 bg-transparent border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 cursor-pointer hover:bg-slate-50 transition-colors">
                        <Download size={11} /> PDF
                      </button>
                    ) : <InvoiceActions invoice={inv as Invoice} />}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Invoice cards — mobile */}
          <div className="flex flex-col gap-3 sm:hidden">
            {displayInvoices.map((inv: any, idx: number) => {
              const isPaid = inv.status === 'paid', isOutstanding = inv.status === 'outstanding'
              const statusClass = isPaid ? 'bg-green-50 text-green-700' : isOutstanding ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
              const statusLabel = isPaid ? 'Paid' : isOutstanding ? 'Outstanding' : 'Overdue'
              let delta = ''
              if (isDemoActive) { delta = DEMO_DELTAS[idx] }
              else {
                const nextInv = displayInvoices[idx + 1]
                if (nextInv) { const pct = ((inv.amount - nextInv.amount) / nextInv.amount * 100); delta = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}`}
              }
              return (
                <div key={inv.id} className="bg-white rounded-xl border border-slate-100 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{inv.period || inv.invoiceNumber || inv.id?.substring(0, 8)}</p>
                      {inv.services && <p className="text-[10px] text-slate-400 mt-0.5">{inv.services.slice(0, 3).join(', ')}{inv.services.length > 3 ? ` +${inv.services.length - 3}` : ''}</p>}
                    </div>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${statusClass}`}>{statusLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xl font-bold text-slate-900">{formatCurrency(inv.amount ?? inv.totalAmount ?? 0)}</p>
                      {delta && <p className={`text-[11px] font-medium mt-0.5 ${delta.startsWith('+') ? 'text-red-600' : 'text-green-700'}`}>{delta.startsWith('+') ? '↑' : '↓'} {delta.replace(/[+-]/, '')}% vs prior month</p>}
                    </div>
                    {isDemoActive ? (
                      <button onClick={() => window.open(inv.downloadUrl || '#', '_blank')} className="flex items-center gap-1 bg-transparent border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 cursor-pointer">
                        <Download size={11} /> PDF
                      </button>
                    ) : <InvoiceActions invoice={inv as Invoice} />}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2 font-mono">{inv.id}</p>
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