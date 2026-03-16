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

export default function InvoicesPage() {
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
            Invoices
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            AWS billing history and monthly invoice management
          </p>
        </div>
        <button
          onClick={() => {
            const csv = displayInvoices.map((inv: any) =>
              `${inv.period},${inv.id},${inv.amount},${inv.status}`
            ).join('\n')
            const blob = new Blob([`Period,Invoice ID,Amount,Status\n${csv}`], { type: 'text/csv' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = 'invoices.csv'; a.click()
          }}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      {/* 3 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'This Month',  value: `$${totalThisMonth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, sub: 'Current billing period',                                           valueColor: '#0F172A'  },
          { label: 'Total Paid',  value: `$${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,     sub: 'All time paid invoices',                                          valueColor: '#059669'  },
          { label: 'Outstanding', value: `$${outstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,   sub: outstanding > 0 ? 'Requires payment' : 'All invoices paid', valueColor: outstanding > 0 ? '#DC2626' : '#059669' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>{label}</p>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{value}</div>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* STATUS FILTER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px' }}>
          {['all', 'paid', 'outstanding', 'overdue'].map(f => (
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
        <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>
          {displayInvoices.length} invoice{displayInvoices.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* ERROR STATE */}
      {displayError && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '14px 20px', marginBottom: '24px' }}>
          <p style={{ fontSize: '0.875rem', color: '#DC2626', margin: 0 }}>
            Unable to load invoices. Please try again or contact support if the issue persists.
          </p>
        </div>
      )}

      {/* INVOICE TABLE */}
      {isLoading && !isDemoActive ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '48px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
          <RefreshCw size={24} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading invoices...</p>
        </div>
      ) : displayInvoices.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '64px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <FileText size={22} style={{ color: '#94A3B8' }} />
          </div>
          <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No invoices found</p>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            AWS billing invoices will appear here once your account is connected.
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden' }}>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 160px 160px 100px 120px', gap: '0', padding: '12px 28px', borderBottom: '1px solid #F1F5F9', background: '#F8FAFC' }}>
            {['Billing Period', 'Invoice ID', 'Issue Date', 'Amount', 'Status', 'Actions'].map(col => (
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

            return (
              <div
                key={inv.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 140px 160px 160px 100px 120px',
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
      )}

      <InvoiceFormDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  )
}
