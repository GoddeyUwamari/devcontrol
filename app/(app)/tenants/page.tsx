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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebounce } from '@/hooks/useDebounce'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { api } from '@/lib/api'
import { Tenant } from '@/lib/types'
import { toast } from 'sonner'
import {
  Search, Sparkles, RefreshCw, Plus,
  Users, XCircle,
  ChevronLeft, ChevronRight
} from 'lucide-react'

// FIX 3: plan field added to each demo tenant
const DEMO_TENANTS: Tenant[] = [
  { id: 't1', name: 'Acme Corporation',      email: 'admin@acme.com',        status: 'active',   plan: 'enterprise', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 120).toISOString() },
  { id: 't2', name: 'TechFlow Systems',      email: 'ops@techflow.io',       status: 'active',   plan: 'pro',        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString()  },
  { id: 't3', name: 'Meridian Analytics',    email: 'team@meridian.co',      status: 'active',   plan: 'pro',        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 75).toISOString()  },
  { id: 't4', name: 'Vertex Capital Group',  email: 'devops@vertexcg.com',   status: 'active',   plan: 'starter',    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString()  },
  { id: 't5', name: 'Nexus Cloud Partners',  email: 'admin@nexuscp.com',     status: 'active',   plan: 'pro',        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString()  },
  { id: 't6', name: 'Pinnacle SaaS Co',      email: 'platform@pinnacle.io',  status: 'active',   plan: 'starter',    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString()  },
  { id: 't7', name: 'Orion Digital Labs',    email: 'eng@orionlabs.dev',     status: 'inactive', plan: 'free',       createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString()  },
  { id: 't8', name: 'Blueshift Ventures',    email: 'cloud@blueshift.vc',    status: 'inactive', plan: 'starter',    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString()   },
]

// FIX 3: plan badge styles
function PlanBadge({ plan }: { plan?: string }) {
  const styles: Record<string, { background: string; color: string }> = {
    free:       { background: '#F1F5F9', color: '#64748B' },
    starter:    { background: '#EFF6FF', color: '#2563EB' },
    pro:        { background: '#F5F3FF', color: '#7C3AED' },
    enterprise: { background: '#FFFBEB', color: '#D97706' },
  }
  const s = styles[plan || 'free'] || styles.free
  return (
    <span style={{
      fontSize: '0.85rem', fontWeight: 700, padding: '3px 10px',
      borderRadius: '100px', width: 'fit-content', display: 'inline-block',
      background: s.background, color: s.color,
    }}>
      {(plan || 'free').charAt(0).toUpperCase() + (plan || 'free').slice(1)}
    </span>
  )
}

export default function TenantsPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const debouncedSearch = useDebounce(searchQuery, 300)
  const itemsPerPage = 10
  const queryClient = useQueryClient()

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  // FIX 1: corrected API path from /api/auth/tenants → /api/tenants
  const { data: tenants, isLoading, error, refetch } = useQuery<Tenant[]>({
    queryKey: ['tenants', debouncedSearch],
    queryFn: async () => {
      const response = await api.get('/api/tenants', {
        params: { search: debouncedSearch || undefined }
      })
      return response.data.data || []
    },
    enabled: !isDemoActive,
  })

  // FIX 2: Add Tenant modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', email: '', plan: 'free' })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleAddTenant = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      setIsSubmitting(true)
      await api.post('/api/tenants', addForm)
      toast.success('Tenant added')
      setIsAddModalOpen(false)
      setAddForm({ name: '', email: '', plan: 'free' })
      queryClient.invalidateQueries({ queryKey: ['tenants'] })
    } catch {
      toast.error('Failed to add tenant')
    } finally {
      setIsSubmitting(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    setCurrentPage(1)
  }

  const displayTenants = isDemoActive ? DEMO_TENANTS : (tenants || [])

  const filteredTenants = displayTenants.filter(t =>
    !debouncedSearch ||
    t.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
    t.email.toLowerCase().includes(debouncedSearch.toLowerCase())
  )

  const paginatedTenants = filteredTenants.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )
  const totalPages = Math.ceil(filteredTenants.length / itemsPerPage)

  const activeCount   = displayTenants.filter(t => t.status === 'active').length
  const inactiveCount = displayTenants.filter(t => t.status === 'inactive').length

  const isAuthError = !isDemoActive && !!error && ((error as any)?.response?.status === 401 || (error as any)?.status === 401)

  return (
    <div style={{
      padding: isMobile ? '24px 16px' : isTablet ? '40px 24px' : '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7C3AED', margin: '0 0 6px' }}>
            Infrastructure
          </p>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Tenant Intelligence
          </h1>
          <p style={{ fontSize: '1rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Monitor revenue, churn risk, and expansion signals across your tenant base.
          </p>
        </div>
        {/* FIX 2: header buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => refetch()}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', color: '#475569', padding: '10px 20px', borderRadius: '8px', fontSize: '1rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer' }}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            onClick={() => !isDemoActive && setIsAddModalOpen(true)}
            disabled={isDemoActive}
            title={isDemoActive ? 'Not available in demo mode' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: isDemoActive ? '#EDE9FE' : '#7C3AED',
              color: isDemoActive ? '#A78BFA' : '#fff',
              padding: '10px 20px', borderRadius: '8px',
              fontSize: '1rem', fontWeight: 600,
              border: 'none', cursor: isDemoActive ? 'not-allowed' : 'pointer',
              opacity: isDemoActive ? 0.7 : 1,
            }}>
            <Plus size={15} /> {displayTenants.length === 0 ? 'Add Your First Tenant' : 'Add Tenant'}
          </button>
        </div>
      </div>

      {/* TENANT INTELLIGENCE STRIP */}
      <div style={{
        background: '#fff', borderRadius: '10px', border: '1px solid #E2E8F0',
        padding: '20px 24px', marginBottom: '16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>

          {/* Active rate ring */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative', width: '54px', height: '54px', flexShrink: 0 }}>
              <svg width="54" height="54" viewBox="0 0 54 54">
                <circle cx="27" cy="27" r="23" fill="none" stroke="#F1F5F9" strokeWidth="5"/>
                <circle cx="27" cy="27" r="23" fill="none"
                  stroke={isDemoActive ? '#059669' : '#94A3B8'}
                  strokeWidth="5"
                  strokeDasharray="144.5"
                  strokeDashoffset={isDemoActive ? 29 : 144.5}
                  strokeLinecap="round"
                  transform="rotate(-90 27 27)"/>
              </svg>
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: isDemoActive ? '#059669' : '#94A3B8' }}>
                {isDemoActive ? '75%' : 'N/A'}
              </span>
            </div>
            <div>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Active Rate</p>
              <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px' }}>
                {isDemoActive ? `${activeCount} of ${displayTenants.length} active` : 'No tenant data'}
              </p>
              <p style={{ fontSize: '0.68rem', color: '#64748B', margin: 0 }}>
                {isDemoActive ? '↓ from 87% last month · 2 churned' : 'Add tenants to begin tracking'}
              </p>
            </div>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          {/* Est. MRR */}
          <div>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Est. MRR</p>
            <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px' }}>
              {isDemoActive ? '$12,400/mo' : '—'}
            </p>
            <p style={{ fontSize: '0.68rem', color: isDemoActive ? '#DC2626' : '#64748B', fontWeight: isDemoActive ? 600 : 400, margin: 0 }}>
              {isDemoActive ? '$1,800/mo at risk (2 inactive)' : 'Connect billing to track MRR'}
            </p>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          {/* Concentration risk */}
          <div>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Concentration Risk</p>
            <p style={{ fontSize: '0.95rem', fontWeight: 700, color: isDemoActive ? '#D97706' : '#0F172A', margin: '0 0 3px' }}>
              {isDemoActive ? 'Top 2 = 46% of usage' : '—'}
            </p>
            <p style={{ fontSize: '0.68rem', color: '#64748B', margin: 0 }}>
              {isDemoActive ? 'Acme + TechFlow dominate usage' : 'Usage data not yet available'}
            </p>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          {/* Churn signal */}
          <div>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Churn Signal</p>
            <p style={{ fontSize: '0.95rem', fontWeight: 700, color: isDemoActive ? '#DC2626' : '#0F172A', margin: '0 0 3px' }}>
              {isDemoActive ? '2 accounts at risk' : '—'}
            </p>
            <p style={{ fontSize: '0.68rem', color: isDemoActive ? '#DC2626' : '#64748B', fontWeight: isDemoActive ? 600 : 400, margin: 0 }}>
              {isDemoActive ? 'Inactive in last 7 days · outreach recommended' : 'No churn signals detected'}
            </p>
          </div>

        </div>
        <a href="/settings/billing" style={{ fontSize: '11px', fontWeight: 700, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          Billing overview
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </a>
      </div>

      {/* AUTH ERROR BANNER */}
      {isAuthError && (
        <div style={{
          background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px',
          padding: '12px 16px', marginBottom: '16px',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#D97706', flexShrink: 0 }} />
          <p style={{ fontSize: '0.82rem', color: '#475569', margin: 0 }}>
            Session expired — <a href="/login?reason=session_expired" style={{ color: '#7C3AED', fontWeight: 600 }}>sign in again</a> to manage tenants.
          </p>
        </div>
      )}

      {/* DECISION INTELLIGENCE */}
      <div style={{
        background: '#fff', borderRadius: '12px', padding: '14px 20px',
        border: '1px solid #E2E8F0', marginBottom: '24px',
        display: 'flex', alignItems: 'flex-start', gap: '14px',
      }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Sparkles size={12} style={{ color: '#fff' }} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Decision Intelligence</p>
          <p style={{ fontSize: '0.84rem', color: '#1E293B', margin: 0, lineHeight: 1.7 }}>
            {isDemoActive
              ? <><strong style={{ color: '#DC2626' }}>2 tenants became inactive in the last 7 days</strong> — potential churn signal. Blueshift Ventures (Starter) and Orion Digital Labs (Free) have gone dark. Top tenant concentration risk: <strong>Acme + TechFlow drive 46% of usage</strong> — over-reliance on 2 accounts.<span style={{ display: 'block', marginTop: '5px', fontSize: '0.78rem', color: '#64748B' }}>Recommended: reach out to recently inactive tenants · consider upsell path for high-usage Starter accounts.</span></>
              : displayTenants.length === 0
                ? <>No tenants registered yet. Add your first tenant to begin tracking usage, billing signals, and churn risk across your platform.<span style={{ display: 'block', marginTop: '5px', fontSize: '0.78rem', color: '#64748B' }}>DevControl will automatically detect usage spikes, high-cost tenants, and churn risk patterns as tenant activity grows.</span></>
                : <>{activeCount} of {displayTenants.length} tenants active. {inactiveCount > 0 ? <><strong style={{ color: '#D97706' }}>{inactiveCount} tenant{inactiveCount > 1 ? 's' : ''} inactive</strong> — review for churn risk.</> : 'All tenants operating normally.'}<span style={{ display: 'block', marginTop: '5px', fontSize: '0.78rem', color: '#64748B' }}>Monitor deployment activity and plan usage to detect expansion and churn signals early.</span></>
            }
          </p>
        </div>
        {isDemoActive && inactiveCount > 0 && (
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#DC2626', flexShrink: 0, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Churn risk active
          </span>
        )}
      </div>

      {/* KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : isTablet ? 'repeat(2,1fr)' : 'repeat(4, 1fr)', gap: '14px', marginBottom: '18px' }}>

        {/* Total Tenants */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 14px' }}>Total Tenants</p>
          <div style={{ fontSize: '2.1rem', fontWeight: 700, color: displayTenants.length === 0 ? '#9CA3AF' : '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '5px' }}>
            {displayTenants.length}
          </div>
          <p style={{ fontSize: '0.72rem', color: '#475569', margin: 0 }}>
            {isDemoActive ? '+2 this month' : 'Registered accounts'}
          </p>
        </div>

        {/* Active */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 14px' }}>Active</p>
          <div style={{ fontSize: '2.1rem', fontWeight: 700, color: activeCount === 0 ? '#9CA3AF' : '#059669', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '5px' }}>
            {activeCount}
          </div>
          <p style={{ fontSize: '0.72rem', color: '#475569', margin: 0 }}>Operating normally</p>
        </div>

        {/* Inactive / Churn Risk */}
        <div style={{ background: inactiveCount > 0 ? '#FFFBEB' : '#fff', borderRadius: '12px', padding: '22px', border: inactiveCount > 0 ? '1px solid #FDE68A' : '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: inactiveCount > 0 ? '#D97706' : '#64748B', margin: '0 0 14px' }}>Churn Risk</p>
          <div style={{ fontSize: '2.1rem', fontWeight: 700, color: inactiveCount === 0 ? '#9CA3AF' : '#D97706', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '5px' }}>
            {inactiveCount}
          </div>
          <p style={{ fontSize: '0.72rem', color: '#475569', margin: '0 0 3px' }}>
            {inactiveCount === 0 ? 'No inactive accounts' : 'Inactive · outreach recommended'}
          </p>
          {inactiveCount > 0 && <p style={{ fontSize: '10px', fontWeight: 700, color: '#D97706', margin: 0 }}>Review now →</p>}
        </div>

        {/* Plan Distribution */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 14px' }}>Plan Mix</p>
          <div style={{ fontSize: '2.1rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '5px' }}>
            {displayTenants.filter((t: any) => t.plan === 'enterprise' || t.plan === 'pro').length}
            <span style={{ fontSize: '1rem', color: '#94A3B8', fontWeight: 400 }}> paid</span>
          </div>
          <p style={{ fontSize: '0.72rem', color: '#475569', margin: 0 }}>
            {isDemoActive
              ? `1 Enterprise · 3 Pro · 2 Starter · 1 Free`
              : `${displayTenants.filter((t: any) => t.plan === 'enterprise').length} Enterprise · ${displayTenants.filter((t: any) => t.plan === 'pro').length} Pro`
            }
          </p>
        </div>

      </div>

      {/* TENANT TABLE */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden', overflowX: isMobile ? 'auto' : 'hidden' }}>

        {/* Table header + search */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          <div>
            <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>All Tenants</p>
            <p style={{ fontSize: '0.9rem', color: '#94A3B8', margin: 0 }}>{filteredTenants.length} accounts</p>
          </div>
          {isDemoActive && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {[
                { label: 'Enterprise', count: 1, color: '#D97706', bg: '#FFFBEB' },
                { label: 'Pro', count: 3, color: '#7C3AED', bg: '#F5F3FF' },
                { label: 'Starter', count: 2, color: '#2563EB', bg: '#EFF6FF' },
                { label: 'Free', count: 1, color: '#64748B', bg: '#F1F5F9' },
              ].map(({ label, count, color, bg }) => (
                <span key={label} style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: bg, color }}>
                  {count} {label}
                </span>
              ))}
            </div>
          )}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
            <input
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search by name or email..."
              style={{ paddingLeft: '32px', paddingRight: '12px', paddingTop: '8px', paddingBottom: '8px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.95rem', color: '#0F172A', outline: 'none', width: '240px', background: '#F8FAFC' }}
            />
          </div>
        </div>

        {/* FIX 3: Column headers — added PLAN between EMAIL and STATUS */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 100px 120px 140px 100px', padding: '10px 28px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
          {['Name', 'Email', 'Plan', 'Status', 'Created', 'Actions'].map(col => (
            <span key={col} style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</span>
          ))}
        </div>

        {/* Rows */}
        {isLoading && !isDemoActive ? (
          <div style={{ padding: isMobile ? '16px 14px' : '48px', textAlign: 'center' }}>
            <RefreshCw size={20} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '1rem', color: '#64748B', margin: 0 }}>Loading tenants...</p>
          </div>
        ) : error && !isDemoActive && !isAuthError ? (
          <div style={{ padding: isMobile ? '16px 14px' : '48px', textAlign: 'center' }}>
            <XCircle size={22} style={{ color: '#DC2626', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '1rem', color: '#DC2626', margin: '0 0 16px' }}>{(error as Error).message}</p>
            <button onClick={() => refetch()} style={{ background: '#7C3AED', color: '#fff', padding: '8px 20px', borderRadius: '8px', fontSize: '1rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
              Retry
            </button>
          </div>
        ) : paginatedTenants.length === 0 && !searchQuery ? (
          <div style={{ padding: isMobile ? '16px 14px' : '48px 32px', textAlign: 'center' }}>
            <p style={{ fontSize: '18px', fontWeight: 500, color: '#0F172A', margin: '0 0 8px' }}>
              No tenants added yet
            </p>
            <p style={{ fontSize: '15px', color: '#475569', lineHeight: 1.6, margin: '0 auto 24px', maxWidth: '400px' }}>
              Add your first tenant to start tracking usage, billing, and activity across your platform.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px', maxWidth: '480px', margin: '0 auto 24px', textAlign: 'left' }}>
              {['Tenant usage trends', 'Billing & plan distribution', 'Activity & health signals', 'AI-detected anomalies'].map(item => (
                <div key={item} style={{ fontSize: '18px', color: '#475569', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#534AB7', flexShrink: 0 }} />
                  {item}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button
                onClick={() => !isDemoActive && setIsAddModalOpen(true)}
                disabled={isDemoActive}
                style={{ background: '#534AB7', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '15px', fontWeight: 500, cursor: isDemoActive ? 'not-allowed' : 'pointer', opacity: isDemoActive ? 0.7 : 1 }}
              >
                + Add Your First Tenant
              </button>
              <button style={{ background: 'none', border: '0.5px solid #E2E8F0', borderRadius: '8px', padding: '8px 16px', fontSize: '15px', color: '#475569', cursor: 'pointer' }}>
                Import tenants
              </button>
            </div>
          </div>
        ) : paginatedTenants.length === 0 ? (
          <div style={{ padding: isMobile ? '16px 14px' : '48px', textAlign: 'center' }}>
            <p style={{ fontSize: '1rem', color: '#475569', margin: 0 }}>No tenants match your search. Try a different query.</p>
          </div>
        ) : (
          paginatedTenants.map((tenant, idx) => {
            const isActive = tenant.status === 'active'
            const isInactive = !isActive
            const isEnterprise = tenant.plan === 'enterprise'
            const rowBg = isInactive ? '#FFFBEB' : '#fff'
            const rowBorder = isInactive
              ? (idx < paginatedTenants.length - 1 ? '1px solid #FDE68A' : 'none')
              : (idx < paginatedTenants.length - 1 ? '1px solid #F8FAFC' : 'none')
            return (
              <div
                key={tenant.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 2fr 100px 120px 140px 100px',
                  padding: '14px 28px',
                  borderBottom: rowBorder,
                  background: rowBg,
                  alignItems: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = isInactive ? '#FEF3C7' : '#F8FAFC' }}
                onMouseLeave={e => { e.currentTarget.style.background = rowBg }}
              >
                {/* Name */}
                <div>
                  <p style={{ fontSize: '1rem', fontWeight: isEnterprise ? 700 : 600, color: '#0F172A', margin: '0 0 1px' }}>
                    {tenant.name}
                    {isEnterprise && (
                      <span style={{ marginLeft: '6px', fontSize: '10px', fontWeight: 700, background: '#FFFBEB', color: '#D97706', padding: '1px 6px', borderRadius: '3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Top Account
                      </span>
                    )}
                  </p>
                  {isInactive && (
                    <p style={{ fontSize: '0.68rem', color: '#D97706', fontWeight: 600, margin: 0 }}>
                      ↓ Inactive · churn risk · outreach recommended
                    </p>
                  )}
                </div>

                {/* Email */}
                <p style={{ fontSize: '0.95rem', color: '#475569', margin: 0 }}>{tenant.email}</p>

                {/* FIX 3: Plan badge */}
                <PlanBadge plan={tenant.plan} />

                {/* Status */}
                <span style={{
                  fontSize: '0.85rem', fontWeight: 700, padding: '3px 10px', borderRadius: '100px', width: 'fit-content',
                  background: isActive ? '#F0FDF4' : '#FEF3C7',
                  color: isActive ? '#059669' : '#D97706',
                }}>
                  {isActive ? 'Active' : 'Inactive'}
                </span>

                {/* Created */}
                <span style={{ fontSize: '0.9rem', color: '#475569' }}>{formatDate(tenant.createdAt)}</span>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => console.log('View', tenant.id)}
                    style={{ fontSize: '0.85rem', fontWeight: 600, color: '#7C3AED', background: '#F5F3FF', border: '1px solid #DDD6FE', padding: '3px 10px', borderRadius: '6px', cursor: 'pointer' }}>
                    View
                  </button>
                  <button
                    onClick={() => console.log('Edit', tenant.id)}
                    style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '3px 10px', borderRadius: '6px', cursor: 'pointer' }}>
                    Edit
                  </button>
                </div>
              </div>
            )
          })
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ padding: '16px 28px', borderTop: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: '0.9rem', color: '#64748B', margin: 0 }}>
              Showing {((currentPage - 1) * itemsPerPage) + 1}–{Math.min(currentPage * itemsPerPage, filteredTenants.length)} of {filteredTenants.length} tenants
            </p>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '6px', fontSize: '0.9rem', fontWeight: 600, border: '1px solid #E2E8F0', background: '#fff', color: currentPage === 1 ? '#CBD5E1' : '#475569', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}>
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '6px', fontSize: '0.9rem', fontWeight: 600, border: '1px solid #E2E8F0', background: '#fff', color: currentPage === totalPages ? '#CBD5E1' : '#475569', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}>
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* FIX 2: Add Tenant Modal */}
      {isAddModalOpen && (
        <div
          onClick={() => setIsAddModalOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, animation: 'fadeIn 0.15s ease',
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '16px', padding: isMobile ? '16px 14px' : '32px', width: '440px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>Add Tenant</h2>
            <p style={{ fontSize: '1rem', color: '#475569', margin: '0 0 24px' }}>Register a new tenant account on this platform.</p>

            <form onSubmit={handleAddTenant}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Company Name *</label>
                <input
                  required
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Acme Corporation"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '1rem', color: '#0F172A', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Admin Email *</label>
                <input
                  required
                  type="email"
                  value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="admin@company.com"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '1rem', color: '#0F172A', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ marginBottom: '28px' }}>
                <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Plan</label>
                <select
                  value={addForm.plan}
                  onChange={e => setAddForm(f => ({ ...f, plan: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '1rem', color: '#0F172A', outline: 'none', background: '#fff', boxSizing: 'border-box' }}>
                  <option value="free">Free</option>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  style={{ padding: '9px 20px', borderRadius: '8px', fontSize: '1rem', fontWeight: 600, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{ padding: '9px 20px', borderRadius: '8px', fontSize: '1rem', fontWeight: 600, border: 'none', background: '#7C3AED', color: '#fff', cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1 }}>
                  {isSubmitting ? 'Adding...' : 'Add Tenant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
