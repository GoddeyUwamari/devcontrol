'use client'

import { useState } from 'react'
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
      fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px',
      borderRadius: '100px', width: 'fit-content', display: 'inline-block',
      background: s.background, color: s.color,
    }}>
      {(plan || 'free').charAt(0).toUpperCase() + (plan || 'free').slice(1)}
    </span>
  )
}

export default function TenantsPage() {
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

  return (
    <div style={{
      padding: '40px 56px 64px',
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
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Tenants
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Manage and monitor all tenant accounts · Multi-tenant platform
          </p>
        </div>
        {/* FIX 2: header buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => refetch()}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', color: '#475569', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer' }}>
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
              fontSize: '0.875rem', fontWeight: 600,
              border: 'none', cursor: isDemoActive ? 'not-allowed' : 'pointer',
              opacity: isDemoActive ? 0.7 : 1,
            }}>
            <Plus size={15} /> Add Tenant
          </button>
        </div>
      </div>

      {/* AI INSIGHT BANNER */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 24px', border: '1px solid #F1F5F9', marginBottom: '24px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Sparkles size={14} style={{ color: '#fff' }} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>AI Insight</p>
          <p style={{ fontSize: '0.875rem', color: '#1E293B', margin: 0, lineHeight: 1.6 }}>
            {isDemoActive
              ? `${activeCount} of ${displayTenants.length} tenants are active. 2 tenants moved to inactive status in the last 7 days. Acme Corporation and TechFlow Systems are your highest-usage tenants by deployment frequency.`
              : displayTenants.length === 0
                ? 'No tenants found. Add your first tenant to start tracking multi-tenant usage and activity.'
                : `${activeCount} active and ${inactiveCount} inactive tenants. ${inactiveCount > 0 ? `${inactiveCount} tenant${inactiveCount > 1 ? 's' : ''} may require attention.` : 'All tenants are active.'}`
            }
          </p>
        </div>
      </div>

      {/* 3 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'Total Tenants', value: displayTenants.length, sub: 'Registered accounts',    valueColor: '#0F172A' },
          { label: 'Active',        value: activeCount,           sub: 'Operating normally',      valueColor: '#059669' },
          { label: 'Inactive',      value: inactiveCount,         sub: 'Suspended or churned',    valueColor: inactiveCount > 0 ? '#D97706' : '#059669' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>{label}</p>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{value}</div>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* TENANT TABLE */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden' }}>

        {/* Table header + search */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>All Tenants</p>
            <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>{filteredTenants.length} accounts</p>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
            <input
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search by name or email..."
              style={{ paddingLeft: '32px', paddingRight: '12px', paddingTop: '8px', paddingBottom: '8px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.82rem', color: '#0F172A', outline: 'none', width: '240px', background: '#F8FAFC' }}
            />
          </div>
        </div>

        {/* FIX 3: Column headers — added PLAN between EMAIL and STATUS */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 100px 120px 140px 100px', padding: '10px 28px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
          {['Name', 'Email', 'Plan', 'Status', 'Created', 'Actions'].map(col => (
            <span key={col} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</span>
          ))}
        </div>

        {/* Rows */}
        {isLoading && !isDemoActive ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <RefreshCw size={20} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading tenants...</p>
          </div>
        ) : error && !isDemoActive ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <XCircle size={22} style={{ color: '#DC2626', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.875rem', color: '#DC2626', margin: '0 0 16px' }}>{(error as Error).message}</p>
            <button onClick={() => refetch()} style={{ background: '#7C3AED', color: '#fff', padding: '8px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
              Retry
            </button>
          </div>
        ) : paginatedTenants.length === 0 ? (
          <div style={{ padding: '64px', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Users size={22} style={{ color: '#94A3B8' }} />
            </div>
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No tenants found</p>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
              {searchQuery ? 'No tenants match your search. Try a different query.' : 'No tenant accounts registered yet.'}
            </p>
          </div>
        ) : (
          paginatedTenants.map((tenant, idx) => {
            const isActive = tenant.status === 'active'
            return (
              <div
                key={tenant.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 2fr 100px 120px 140px 100px',
                  padding: '14px 28px',
                  borderBottom: idx < paginatedTenants.length - 1 ? '1px solid #F8FAFC' : 'none',
                  alignItems: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F8FAFC' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {/* Name */}
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{tenant.name}</p>

                {/* Email */}
                <p style={{ fontSize: '0.82rem', color: '#475569', margin: 0 }}>{tenant.email}</p>

                {/* FIX 3: Plan badge */}
                <PlanBadge plan={tenant.plan} />

                {/* Status */}
                <span style={{
                  fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '100px', width: 'fit-content',
                  background: isActive ? '#F0FDF4' : '#F8FAFC',
                  color: isActive ? '#059669' : '#64748B',
                }}>
                  {isActive ? 'Active' : 'Inactive'}
                </span>

                {/* Created */}
                <span style={{ fontSize: '0.78rem', color: '#475569' }}>{formatDate(tenant.createdAt)}</span>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => console.log('View', tenant.id)}
                    style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', background: '#F5F3FF', border: '1px solid #DDD6FE', padding: '3px 10px', borderRadius: '6px', cursor: 'pointer' }}>
                    View
                  </button>
                  <button
                    onClick={() => console.log('Edit', tenant.id)}
                    style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '3px 10px', borderRadius: '6px', cursor: 'pointer' }}>
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
            <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0 }}>
              Showing {((currentPage - 1) * itemsPerPage) + 1}–{Math.min(currentPage * itemsPerPage, filteredTenants.length)} of {filteredTenants.length} tenants
            </p>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, border: '1px solid #E2E8F0', background: '#fff', color: currentPage === 1 ? '#CBD5E1' : '#475569', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}>
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, border: '1px solid #E2E8F0', background: '#fff', color: currentPage === totalPages ? '#CBD5E1' : '#475569', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}>
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
            style={{ background: '#fff', borderRadius: '16px', padding: '32px', width: '440px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>Add Tenant</h2>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 24px' }}>Register a new tenant account on this platform.</p>

            <form onSubmit={handleAddTenant}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Company Name *</label>
                <input
                  required
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Acme Corporation"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Admin Email *</label>
                <input
                  required
                  type="email"
                  value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="admin@company.com"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ marginBottom: '28px' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Plan</label>
                <select
                  value={addForm.plan}
                  onChange={e => setAddForm(f => ({ ...f, plan: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', outline: 'none', background: '#fff', boxSizing: 'border-box' }}>
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
                  style={{ padding: '9px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{ padding: '9px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', background: '#7C3AED', color: '#fff', cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1 }}>
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
