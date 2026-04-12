'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Plus, X, Crown } from 'lucide-react'
import { useAuth } from '@/lib/contexts/auth-context'
import { organizationsService } from '@/lib/services/organizations.service'
import type { OrganizationMember, InviteMemberRequest } from '@/lib/services/organizations.service'
import { subscriptionsService } from '@/lib/services/subscriptions.service'
import { invoicesService } from '@/lib/services/invoices.service'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'

const DEMO_SUBSCRIPTION = { id: 'sub-demo-1', plan: 'Enterprise', status: 'active' as const, billingCycle: 'yearly' as const, currentPrice: 1498800, currency: 'USD', currentPeriodStart: '2024-01-01T00:00:00Z', currentPeriodEnd: '2025-01-01T00:00:00Z', nextBillingDate: '2025-01-01T00:00:00Z', autoRenew: true, isTrial: false }

const DEMO_MEMBERS: OrganizationMember[] = [
  { id: 'm1', userId: 'u1', organizationId: 'org-demo', role: 'owner',  joinedAt: '2024-01-01T00:00:00Z', user: { id: 'u1', email: 'cto@wayup.com',      fullName: 'Alex Morgan'   } },
  { id: 'm2', userId: 'u2', organizationId: 'org-demo', role: 'admin',  joinedAt: '2024-01-15T00:00:00Z', user: { id: 'u2', email: 'platform@wayup.com', fullName: 'Jordan Lee'    } },
  { id: 'm3', userId: 'u3', organizationId: 'org-demo', role: 'admin',  joinedAt: '2024-02-01T00:00:00Z', user: { id: 'u3', email: 'devops@wayup.com',   fullName: 'Sam Rivera'    } },
  { id: 'm4', userId: 'u4', organizationId: 'org-demo', role: 'member', joinedAt: '2024-02-10T00:00:00Z', user: { id: 'u4', email: 'security@wayup.com', fullName: 'Taylor Chen'   } },
  { id: 'm5', userId: 'u5', organizationId: 'org-demo', role: 'viewer', joinedAt: '2024-03-01T00:00:00Z', user: { id: 'u5', email: 'finance@wayup.com',  fullName: 'Morgan Park'   } },
]

const DEMO_MEMBER_META: Record<string, { lastActive: string; status: 'active' | 'inactive' }> = {
  'm1': { lastActive: '2 hours ago', status: 'active'   },
  'm2': { lastActive: 'Today',       status: 'active'   },
  'm3': { lastActive: 'Yesterday',   status: 'active'   },
  'm4': { lastActive: '3 days ago',  status: 'active'   },
  'm5': { lastActive: '18 days ago', status: 'inactive' },
}

const DEMO_INVOICES = [
  { id: 'inv-1', number: 'INV-2024-001', amount: 1498800, currency: 'USD', status: 'paid', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'inv-2', number: 'INV-2023-012', amount: 1498800, currency: 'USD', status: 'paid', createdAt: '2023-01-01T00:00:00Z' },
]

function formatCurrency(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(amount / 100)
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
function roleStyle(role: OrganizationMember['role']) {
  return ({ owner: { bg: 'bg-violet-50 text-violet-700', border: 'border-violet-600' }, admin: { bg: 'bg-blue-50 text-blue-600', border: 'border-blue-500' }, member: { bg: 'bg-green-50 text-green-600', border: 'border-green-500' }, viewer: { bg: 'bg-slate-50 text-slate-500', border: 'border-slate-400' } }[role] ?? { bg: 'bg-slate-50 text-slate-500', border: 'border-slate-400' })
}

const securityControls = [
  { name: 'SOC 2 Type II',   status: 'active',  detail: 'Certified · Annual audit' },
  { name: 'GDPR',            status: 'active',  detail: 'Compliant · DPA available' },
  { name: 'HIPAA',           status: 'active',  detail: 'Ready · BAA on request' },
  { name: 'SSO / SAML',      status: 'warning', detail: 'Not configured · Available in Enterprise' },
  { name: 'Audit Log',       status: 'active',  detail: '2-year retention · Live' },
  { name: 'Data Encryption', status: 'active',  detail: 'AES-256 at rest · TLS 1.3' },
  { name: 'MFA Enforcement', status: 'warning', detail: 'Not enforced · Recommended' },
]

export default function EnterprisePage() {
  const router = useRouter()
  const demoMode = useDemoMode()
  const { organization } = useAuth()
  const orgId = organization?.id
  const queryClient = useQueryClient()
  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState<{ email: string; role: 'admin' | 'member' | 'viewer' }>({ email: '', role: 'member' })
  const [inviteError, setInviteError] = useState('')

  const { data: subscriptions = [] } = useQuery({ queryKey: ['subscriptions'], queryFn: subscriptionsService.getAll, enabled: !demoMode })
  const subscription = demoMode ? DEMO_SUBSCRIPTION : (subscriptions[0] ?? null)

  const { data: members = [] } = useQuery({ queryKey: ['org-members', orgId], queryFn: () => organizationsService.getMembers(orgId!), enabled: !demoMode && !!orgId })
  const displayMembers = demoMode ? DEMO_MEMBERS : members

  const { data: invoices = [] } = useQuery({ queryKey: ['invoices'], queryFn: invoicesService.getAll, enabled: !demoMode })
  const displayInvoices = demoMode ? DEMO_INVOICES : invoices

  const inviteMutation = useMutation({
    mutationFn: (data: InviteMemberRequest) => organizationsService.inviteMember(orgId!, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['org-members'] }); setShowInvite(false); setInviteForm({ email: '', role: 'member' }); setInviteError('') },
    onError: () => setInviteError('Failed to send invitation. Please try again.'),
  })

  const handleInvite = () => {
    if (!inviteForm.email.trim()) { setInviteError('Email is required.'); return }
    inviteMutation.mutate({ email: inviteForm.email.trim(), role: inviteForm.role })
  }

  const adminCount = displayMembers.filter(m => m.role === 'admin' || m.role === 'owner').length

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1400px] mx-auto">

      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5">Enterprise Governance &amp; Control</h1>
        <p className="text-sm text-slate-500 leading-relaxed">Secure your platform, manage access, and maintain full visibility across teams, cost, and infrastructure.</p>
      </div>

      {/* Plan + Compliance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">

        {/* Plan card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5">Current Plan</p>
          {subscription ? (
            <>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 bg-violet-50 rounded-xl flex items-center justify-center shrink-0"><Crown size={18} className="text-violet-600" /></div>
                <div>
                  <div className="text-xl font-bold text-slate-900 tracking-tight">{subscription.plan ?? 'Enterprise'}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${subscription.status === 'active' ? 'bg-green-500' : 'bg-amber-500'}`} />
                    <span className="text-xs text-slate-500 capitalize">{subscription.status} · {subscription.billingCycle}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 mb-5">
                {[
                  { label: 'Current price', value: formatCurrency(subscription.currentPrice, subscription.currency) + (subscription.billingCycle === 'yearly' ? '/yr' : '/mo') },
                  { label: 'Next billing', value: subscription.nextBillingDate ? formatDate(subscription.nextBillingDate) : '—' },
                  { label: 'Period start', value: formatDate(subscription.currentPeriodStart) },
                  { label: 'Period end',   value: formatDate(subscription.currentPeriodEnd) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-slate-50 rounded-lg px-3.5 py-3">
                    <div className="text-[11px] text-slate-400 mb-1">{label}</div>
                    <div className="text-xs font-semibold text-slate-900">{value}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2.5">
                <button className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 border-none rounded-lg text-xs font-semibold text-white cursor-pointer transition-colors">Manage Plan</button>
                <button className="flex-1 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors">View Invoices ↓</button>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-sm font-medium text-slate-900 mb-1">Free</p>
                <p className="text-xs text-slate-500 mb-3">1 AWS account · 5 AI reports/month · Community support</p>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-violet-50 text-violet-700">Current plan</span>
              </div>
              <div className="border-2 border-violet-600 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900 mb-0.5">Pro</p>
                    <p className="text-xs text-slate-500">Ideal for scaling teams with advanced compliance features</p>
                  </div>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-violet-50 text-violet-700 shrink-0 ml-2">Most popular</span>
                </div>
                <div className="flex flex-col gap-1 my-3">
                  {['Unlimited AWS accounts', 'SOC 2 & automated audits', 'Unlimited AI reports', 'Priority support'].map(f => (
                    <div key={f} className="text-xs text-slate-500 flex items-center gap-1.5"><span className="text-green-600">✓</span> {f}</div>
                  ))}
                </div>
                <button className="w-full bg-violet-700 hover:bg-violet-800 text-white border-none rounded-lg py-2 text-xs font-medium cursor-pointer transition-colors">Upgrade to Pro →</button>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <p className="text-sm font-medium text-slate-900 mb-1">Enterprise</p>
                <p className="text-xs text-slate-500 mb-3">SSO, priority support, tailored security, and custom contracts</p>
                <button className="w-full bg-transparent border border-slate-200 rounded-lg py-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50 transition-colors">Contact Sales →</button>
              </div>
            </div>
          )}
        </div>

        {/* Compliance card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5">Security &amp; Compliance</p>
          <div className="flex flex-col">
            {securityControls.map(({ name, status, detail }) => (
              <div key={name} className="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
                <span className={`text-base shrink-0 leading-none ${status === 'active' ? 'text-green-600' : 'text-amber-500'}`}>{status === 'active' ? '✓' : '⚠'}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-slate-900">{name}</span>
                  <span className={`text-xs ml-2 ${status === 'active' ? 'text-slate-400' : 'text-amber-500'}`}>{detail}</span>
                </div>
                <button className="text-xs font-semibold text-violet-600 bg-transparent border-none cursor-pointer shrink-0 hover:text-violet-800 transition-colors">Docs →</button>
              </div>
            ))}
          </div>
          <div className="pt-3 mt-1 border-t border-slate-100">
            <button onClick={() => router.push('/audit-logs')} className="text-xs text-violet-700 bg-transparent border-none cursor-pointer p-0 hover:text-violet-900 transition-colors">
              View Security Audit Logs → Last 30 days
            </button>
          </div>
        </div>
      </div>

      {/* Members */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Organisation Members</p>
            <p className="text-xs text-slate-400">{displayMembers.length} member{displayMembers.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => setShowInvite(true)} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-lg text-xs font-semibold border-none cursor-pointer transition-colors whitespace-nowrap self-start sm:self-auto">
            <Plus size={13} /> Invite Member
          </button>
        </div>

        {adminCount <= 1 && (
          <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 mb-4">
            ⚠ Only {adminCount} admin configured. Consider adding backup admins to reduce access risk.
          </div>
        )}

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <div className="grid pb-2.5 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-widest min-w-[560px]" style={{ gridTemplateColumns: '2fr 2fr 120px 80px 90px', gap: '12px' }}>
            <span>Member</span><span>Email</span><span>Last Active</span><span>Status</span><span className="text-center">Role</span>
          </div>
          {displayMembers.map(m => {
            const rs = roleStyle(m.role)
            const meta = DEMO_MEMBER_META[m.id]
            const initials = (m.user ? (m.user.fullName ?? m.user.email ?? '?') : '?').split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
            const lastActive = demoMode && meta ? meta.lastActive : '—'
            const memberStatus = demoMode && meta ? meta.status : null
            return (
              <div key={m.id} className="grid py-3 border-b border-slate-50 last:border-0 items-center min-w-[560px]" style={{ gridTemplateColumns: '2fr 2fr 120px 80px 90px', gap: '12px' }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-violet-50 rounded-lg flex items-center justify-center text-[10px] font-bold text-violet-700 shrink-0">{initials}</div>
                  <span className="text-sm font-semibold text-slate-900 truncate">{m.user?.fullName || m.user?.email || '—'}</span>
                </div>
                <span className="text-xs text-slate-500 truncate">{m.user?.email ?? '—'}</span>
                <span className="text-xs text-slate-400">{lastActive}</span>
                <div>
                  {memberStatus ? (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${memberStatus === 'active' ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-400'}`}>{memberStatus}</span>
                  ) : <span className="text-xs text-slate-300">—</span>}
                </div>
                <div className="text-center">
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full capitalize ${rs.bg}`}>{m.role}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden flex flex-col divide-y divide-slate-50">
          {displayMembers.map(m => {
            const rs = roleStyle(m.role)
            const meta = DEMO_MEMBER_META[m.id]
            const initials = (m.user ? (m.user.fullName ?? m.user.email ?? '?') : '?').split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
            const memberStatus = demoMode && meta ? meta.status : null
            return (
              <div key={m.id} className="py-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 bg-violet-50 rounded-lg flex items-center justify-center text-[10px] font-bold text-violet-700 shrink-0">{initials}</div>
                    <span className="text-sm font-semibold text-slate-900 truncate">{m.user?.fullName || m.user?.email || '—'}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full capitalize shrink-0 ${rs.bg}`}>{m.role}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400 pl-9">
                  <span>{m.user?.email ?? '—'}</span>
                  {memberStatus && <span className={memberStatus === 'active' ? 'text-green-600' : 'text-slate-300'}>{memberStatus}</span>}
                </div>
              </div>
            )
          })}
        </div>

        <button onClick={() => setShowInvite(true)} className="text-xs text-violet-700 bg-transparent border-none cursor-pointer flex items-center gap-1 mt-4 p-0 hover:text-violet-900 transition-colors">
          Invite Multiple Members →
        </button>
      </div>

      {/* Invoices */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5">Invoices &amp; Billing</p>
        {displayInvoices.length === 0 ? (
          <div>
            <p className="text-sm text-slate-900 mb-1">Your next invoice: <strong>$0</strong> · Free plan</p>
            <p className="text-xs text-slate-500 mb-3">Upgrade to Pro to unlock billing history and downloadable invoices.</p>
            <button onClick={() => router.push('/billing')} className="text-xs text-violet-700 bg-transparent border-none cursor-pointer p-0 hover:text-violet-900 transition-colors">View billing details →</button>
          </div>
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden sm:block overflow-x-auto">
              <div className="grid pb-2.5 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-widest min-w-[400px]" style={{ gridTemplateColumns: '1fr 1fr 110px 70px', gap: '12px' }}>
                <span>Invoice</span><span>Date</span><span>Amount</span><span>Status</span>
              </div>
              {displayInvoices.map((inv: any) => (
                <div key={inv.id} className="grid py-3 border-b border-slate-50 last:border-0 items-center min-w-[400px]" style={{ gridTemplateColumns: '1fr 1fr 110px 70px', gap: '12px' }}>
                  <span className="text-sm font-semibold text-slate-900">{inv.number ?? inv.id}</span>
                  <span className="text-xs text-slate-500">{formatDate(inv.createdAt)}</span>
                  <span className="text-sm font-semibold text-slate-900">{formatCurrency(inv.amount, inv.currency)}</span>
                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full capitalize w-fit ${inv.status === 'paid' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>{inv.status}</span>
                </div>
              ))}
            </div>
            {/* Mobile cards */}
            <div className="sm:hidden flex flex-col divide-y divide-slate-50">
              {displayInvoices.map((inv: any) => (
                <div key={inv.id} className="py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-slate-900">{inv.number ?? inv.id}</span>
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full capitalize ${inv.status === 'paid' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>{inv.status}</span>
                  </div>
                  <div className="flex gap-3 text-xs text-slate-400">
                    <span>{formatDate(inv.createdAt)}</span>
                    <span className="font-semibold text-slate-700">{formatCurrency(inv.amount, inv.currency)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-slate-900/50 flex sm:items-center items-end justify-center z-50 px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-2xl p-5 sm:p-8 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-bold text-slate-900">Invite Member</h2>
              <button onClick={() => { setShowInvite(false); setInviteError('') }} className="bg-transparent border-none cursor-pointer text-slate-300 hover:text-slate-600 p-1 transition-colors"><X size={16} /></button>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email address <span className="text-red-600">*</span></label>
              <input type="email" value={inviteForm.email} onChange={e => { setInviteForm(f => ({ ...f, email: e.target.value })); setInviteError('') }} placeholder="colleague@company.com"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-xs text-slate-900 bg-slate-50 outline-none focus:border-violet-600 focus:bg-white transition-colors box-border" />
            </div>
            <div className="mb-5">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Role</label>
              <div className="flex gap-2">
                {(['admin', 'member', 'viewer'] as const).map(r => {
                  const rs = roleStyle(r)
                  const sel = inviteForm.role === r
                  return (
                    <button key={r} onClick={() => setInviteForm(f => ({ ...f, role: r }))}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold cursor-pointer capitalize transition-all border-2 ${sel ? `${rs.bg} ${rs.border}` : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
                      {r}
                    </button>
                  )
                })}
              </div>
            </div>
            {inviteError && <p className="text-xs text-red-600 mb-4">{inviteError}</p>}
            <div className="flex gap-2.5">
              <button onClick={() => { setShowInvite(false); setInviteError('') }} className="flex-1 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 cursor-pointer hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={handleInvite} disabled={inviteMutation.isPending}
                className={`flex-1 py-2.5 bg-violet-600 border-none rounded-xl text-xs font-semibold text-white transition-colors ${inviteMutation.isPending ? 'opacity-70 cursor-not-allowed' : 'hover:bg-violet-700 cursor-pointer'}`}>
                {inviteMutation.isPending ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}