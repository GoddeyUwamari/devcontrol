'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  X,
  Crown,
  CheckCircle,
} from 'lucide-react'
import { useAuth } from '@/lib/contexts/auth-context'
import { organizationsService } from '@/lib/services/organizations.service'
import type {
  OrganizationMember,
  InviteMemberRequest,
} from '@/lib/services/organizations.service'
import { subscriptionsService } from '@/lib/services/subscriptions.service'
import { invoicesService } from '@/lib/services/invoices.service'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'

// ── DEMO DATA ──────────────────────────────────────────────────────────────────

const DEMO_SUBSCRIPTION = {
  id: 'sub-demo-1',
  plan: 'Enterprise',
  status: 'active' as const,
  billingCycle: 'yearly' as const,
  currentPrice: 1498800,
  currency: 'USD',
  currentPeriodStart: '2024-01-01T00:00:00Z',
  currentPeriodEnd: '2025-01-01T00:00:00Z',
  nextBillingDate: '2025-01-01T00:00:00Z',
  autoRenew: true,
  isTrial: false,
}

const DEMO_MEMBERS: OrganizationMember[] = [
  {
    id: 'm1',
    userId: 'u1',
    organizationId: 'org-demo',
    role: 'owner',
    joinedAt: '2024-01-01T00:00:00Z',
    user: { id: 'u1', email: 'cto@wayup.com', fullName: 'Alex Morgan' },
  },
  {
    id: 'm2',
    userId: 'u2',
    organizationId: 'org-demo',
    role: 'admin',
    joinedAt: '2024-01-15T00:00:00Z',
    user: { id: 'u2', email: 'platform@wayup.com', fullName: 'Jordan Lee' },
  },
  {
    id: 'm3',
    userId: 'u3',
    organizationId: 'org-demo',
    role: 'admin',
    joinedAt: '2024-02-01T00:00:00Z',
    user: { id: 'u3', email: 'devops@wayup.com', fullName: 'Sam Rivera' },
  },
  {
    id: 'm4',
    userId: 'u4',
    organizationId: 'org-demo',
    role: 'member',
    joinedAt: '2024-02-10T00:00:00Z',
    user: { id: 'u4', email: 'security@wayup.com', fullName: 'Taylor Chen' },
  },
  {
    id: 'm5',
    userId: 'u5',
    organizationId: 'org-demo',
    role: 'viewer',
    joinedAt: '2024-03-01T00:00:00Z',
    user: { id: 'u5', email: 'finance@wayup.com', fullName: 'Morgan Park' },
  },
]

const DEMO_INVOICES = [
  {
    id: 'inv-1',
    number: 'INV-2024-001',
    amount: 1498800,
    currency: 'USD',
    status: 'paid',
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'inv-2',
    number: 'INV-2023-012',
    amount: 1498800,
    currency: 'USD',
    status: 'paid',
    createdAt: '2023-01-01T00:00:00Z',
  },
]

// ── HELPERS ────────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(amount / 100)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function roleStyle(role: OrganizationMember['role']): { background: string; color: string } {
  const map = {
    owner:  { background: '#F5F3FF', color: '#7C3AED' },
    admin:  { background: '#EFF6FF', color: '#2563EB' },
    member: { background: '#F0FDF4', color: '#059669' },
    viewer: { background: '#F8FAFC', color: '#64748B' },
  }
  return map[role] ?? map.viewer
}

// ── PAGE ───────────────────────────────────────────────────────────────────────

export default function EnterprisePage() {
  const { demoMode } = useDemoMode()
  const { organization } = useAuth()
  const orgId = organization?.id
  const queryClient = useQueryClient()

  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState<{
    email: string
    role: 'admin' | 'member' | 'viewer'
  }>({ email: '', role: 'member' })
  const [inviteError, setInviteError] = useState('')

  // Subscription
  const { data: subscriptions = [] } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: subscriptionsService.getAll,
    enabled: !demoMode,
  })
  const subscription = demoMode ? DEMO_SUBSCRIPTION : (subscriptions[0] ?? null)

  // Members
  const { data: members = [] } = useQuery({
    queryKey: ['org-members', orgId],
    queryFn: () => organizationsService.getMembers(orgId!),
    enabled: !demoMode && !!orgId,
  })
  const displayMembers = demoMode ? DEMO_MEMBERS : members

  // Invoices
  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: invoicesService.getAll,
    enabled: !demoMode,
  })
  const displayInvoices = demoMode ? DEMO_INVOICES : invoices

  // Invite mutation
  const inviteMutation = useMutation({
    mutationFn: (data: InviteMemberRequest) =>
      organizationsService.inviteMember(orgId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members'] })
      setShowInvite(false)
      setInviteForm({ email: '', role: 'member' })
      setInviteError('')
    },
    onError: () => {
      setInviteError('Failed to send invitation. Please try again.')
    },
  })

  const handleInvite = () => {
    if (!inviteForm.email.trim()) {
      setInviteError('Email is required.')
      return
    }
    inviteMutation.mutate({ email: inviteForm.email.trim(), role: inviteForm.role })
  }

  return (
    <div style={{ padding: '40px 56px 80px', maxWidth: '1400px', margin: '0 auto' }}>

      {/* PAGE HEADER */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{
          fontSize: '1.7rem',
          fontWeight: 700,
          color: '#0F172A',
          letterSpacing: '-0.025em',
          marginBottom: '6px',
          lineHeight: 1.2,
        }}>
          Enterprise
        </h1>
        <p style={{ fontSize: '14px', color: '#475569', lineHeight: 1.5 }}>
          Plan, organisation, members, and compliance settings.
        </p>
      </div>

      {/* TOP ROW: Plan + Compliance */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '20px',
        marginBottom: '20px',
      }}>

        {/* PLAN STATUS CARD */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: '16px',
          padding: '28px',
        }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#334155',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: '20px',
          }}>
            Current Plan
          </div>

          {subscription ? (
            <>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '20px',
              }}>
                <div style={{
                  width: '44px',
                  height: '44px',
                  background: '#F5F3FF',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Crown size={20} style={{ color: '#7C3AED' }} />
                </div>
                <div>
                  <div style={{
                    fontSize: '1.2rem',
                    fontWeight: 700,
                    color: '#0F172A',
                    letterSpacing: '-0.02em',
                  }}>
                    {subscription.plan ?? 'Enterprise'}
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginTop: '3px',
                  }}>
                    <span style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: subscription.status === 'active' ? '#059669' : '#D97706',
                      display: 'inline-block',
                    }} />
                    <span style={{
                      fontSize: '13px',
                      color: '#334155',
                      textTransform: 'capitalize',
                    }}>
                      {subscription.status} · {subscription.billingCycle}
                    </span>
                  </div>
                </div>
              </div>

              {/* Plan details grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                marginBottom: '20px',
              }}>
                {[
                  {
                    label: 'Current price',
                    value:
                      formatCurrency(subscription.currentPrice, subscription.currency) +
                      (subscription.billingCycle === 'yearly' ? '/yr' : '/mo'),
                  },
                  {
                    label: 'Next billing',
                    value: subscription.nextBillingDate
                      ? formatDate(subscription.nextBillingDate)
                      : '—',
                  },
                  {
                    label: 'Period start',
                    value: formatDate(subscription.currentPeriodStart),
                  },
                  {
                    label: 'Period end',
                    value: formatDate(subscription.currentPeriodEnd),
                  },
                ].map(({ label, value }) => (
                  <div key={label} style={{
                    background: '#F8FAFC',
                    borderRadius: '8px',
                    padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '4px' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button style={{
                  flex: 1,
                  padding: '9px',
                  background: '#7C3AED',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#fff',
                  cursor: 'pointer',
                }}>
                  Manage Plan
                </button>
                <button style={{
                  flex: 1,
                  padding: '9px',
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#334155',
                  cursor: 'pointer',
                }}>
                  View Invoices ↓
                </button>
              </div>
            </>
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '32px 0',
              color: '#64748B',
              fontSize: '14px',
            }}>
              No active subscription found.
            </div>
          )}
        </div>

        {/* COMPLIANCE CARD */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: '16px',
          padding: '28px',
        }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#334155',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: '20px',
          }}>
            Security & Compliance
          </div>

          {[
            { label: 'SOC 2 Type II',      desc: 'Certified · Annual audit' },
            { label: 'GDPR',               desc: 'Compliant · DPA available' },
            { label: 'HIPAA',              desc: 'Ready · BAA on request' },
            { label: 'SSO / SAML',         desc: 'Okta, Azure AD, any SAML 2.0' },
            { label: 'Audit Log',          desc: '2-year retention' },
            { label: 'Data Encryption',    desc: 'AES-256 at rest · TLS 1.3' },
          ].map(({ label, desc }) => (
            <div key={label} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 0',
              borderBottom: '1px solid #F1F5F9',
            }}>
              <CheckCircle size={15} style={{ color: '#059669', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>
                  {label}
                </span>
                <span style={{ fontSize: '13px', color: '#94A3B8', marginLeft: '8px' }}>
                  {desc}
                </span>
              </div>
              <button style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#7C3AED',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}>
                Docs →
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* MEMBERS */}
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: '16px',
        padding: '28px',
        marginBottom: '20px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
        }}>
          <div>
            <div style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#334155',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: '4px',
            }}>
              Organisation Members
            </div>
            <div style={{ fontSize: '13px', color: '#94A3B8' }}>
              {displayMembers.length} member{displayMembers.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            onClick={() => setShowInvite(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#7C3AED',
              color: '#fff',
              padding: '9px 18px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Plus size={14} />
            Invite Member
          </button>
        </div>

        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '2fr 2fr 1fr 100px',
          gap: '12px',
          padding: '0 0 10px',
          borderBottom: '1px solid #F1F5F9',
          fontSize: '12px',
          fontWeight: 700,
          color: '#64748B',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          <span>Member</span>
          <span>Email</span>
          <span>Joined</span>
          <span style={{ textAlign: 'center' }}>Role</span>
        </div>

        {/* Member rows */}
        {displayMembers.map((m) => {
          const rs = roleStyle(m.role)
          const initials = m.user
            ? (m.user.fullName ?? m.user.email ?? '?')
                .split(' ')
                .map((w: string) => w[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('')
                .toUpperCase()
            : '?'
          return (
            <div key={m.id} style={{
              display: 'grid',
              gridTemplateColumns: '2fr 2fr 1fr 100px',
              gap: '12px',
              padding: '12px 0',
              borderBottom: '1px solid #F1F5F9',
              alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  background: '#F5F3FF',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#7C3AED',
                  flexShrink: 0,
                }}>
                  {initials}
                </div>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>
                  {m.user?.fullName || '—'}
                </span>
              </div>
              <span style={{ fontSize: '13px', color: '#475569' }}>{m.user?.email ?? '—'}</span>
              <span style={{ fontSize: '13px', color: '#94A3B8' }}>{formatDate(m.joinedAt)}</span>
              <div style={{ textAlign: 'center' }}>
                <span style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: '99px',
                  background: rs.background,
                  color: rs.color,
                  textTransform: 'capitalize',
                }}>
                  {m.role}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* INVOICES */}
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: '16px',
        padding: '28px',
      }}>
        <div style={{
          fontSize: '11px',
          fontWeight: 700,
          color: '#334155',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '20px',
        }}>
          Invoices
        </div>

        {displayInvoices.length === 0 ? (
          <p style={{
            fontSize: '14px',
            color: '#64748B',
            textAlign: 'center',
            padding: '24px 0',
          }}>
            No invoices yet.
          </p>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 120px 80px',
              gap: '12px',
              padding: '0 0 10px',
              borderBottom: '1px solid #F1F5F9',
              fontSize: '12px',
              fontWeight: 700,
              color: '#64748B',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              <span>Invoice</span>
              <span>Date</span>
              <span>Amount</span>
              <span>Status</span>
            </div>

            {displayInvoices.map((inv: any) => (
              <div key={inv.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 120px 80px',
                gap: '12px',
                padding: '12px 0',
                borderBottom: '1px solid #F1F5F9',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>
                  {inv.number ?? inv.id}
                </span>
                <span style={{ fontSize: '13px', color: '#475569' }}>
                  {formatDate(inv.createdAt)}
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>
                  {formatCurrency(inv.amount, inv.currency)}
                </span>
                <span style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: '99px',
                  background: inv.status === 'paid' ? '#ECFDF5' : '#FFFBEB',
                  color: inv.status === 'paid' ? '#059669' : '#D97706',
                  textTransform: 'capitalize',
                }}>
                  {inv.status}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* INVITE MODAL */}
      {showInvite && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15,23,42,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
          padding: '24px',
        }}>
          <div style={{
            background: '#FFFFFF',
            borderRadius: '20px',
            padding: '32px',
            width: '100%',
            maxWidth: '440px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.15)',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '24px',
            }}>
              <h2 style={{
                fontSize: '1.1rem',
                fontWeight: 700,
                color: '#0F172A',
                letterSpacing: '-0.01em',
              }}>
                Invite Member
              </h2>
              <button
                onClick={() => { setShowInvite(false); setInviteError('') }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748B',
                  display: 'flex',
                  padding: '4px',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Email */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 600,
                color: '#374151',
                marginBottom: '6px',
              }}>
                Email address
                <span style={{ color: '#DC2626', marginLeft: '3px' }}>*</span>
              </label>
              <input
                type="email"
                value={inviteForm.email}
                onChange={e => {
                  setInviteForm(f => ({ ...f, email: e.target.value }))
                  setInviteError('')
                }}
                placeholder="colleague@company.com"
                style={{
                  width: '100%',
                  padding: '9px 14px',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: '#0F172A',
                  outline: 'none',
                  boxSizing: 'border-box',
                  background: '#FAFAFA',
                }}
                onFocus={e => {
                  e.target.style.border = '1px solid #7C3AED'
                  e.target.style.background = '#FFFFFF'
                }}
                onBlur={e => {
                  e.target.style.border = '1px solid #E2E8F0'
                  e.target.style.background = '#FAFAFA'
                }}
              />
            </div>

            {/* Role */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 600,
                color: '#374151',
                marginBottom: '6px',
              }}>
                Role
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['admin', 'member', 'viewer'] as const).map(r => {
                  const rs = roleStyle(r)
                  const selected = inviteForm.role === r
                  return (
                    <button
                      key={r}
                      onClick={() => setInviteForm(f => ({ ...f, role: r }))}
                      style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 600,
                        border: selected ? `2px solid ${rs.color}` : '2px solid #E2E8F0',
                        background: selected ? rs.background : '#F8FAFC',
                        color: selected ? rs.color : '#94A3B8',
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                      }}
                    >
                      {r}
                    </button>
                  )
                })}
              </div>
            </div>

            {inviteError && (
              <p style={{ fontSize: '13px', color: '#DC2626', marginBottom: '16px' }}>
                {inviteError}
              </p>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => { setShowInvite(false); setInviteError('') }}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: '9px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleInvite}
                disabled={inviteMutation.isPending}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#7C3AED',
                  border: 'none',
                  borderRadius: '9px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#fff',
                  cursor: inviteMutation.isPending ? 'not-allowed' : 'pointer',
                  opacity: inviteMutation.isPending ? 0.7 : 1,
                }}
              >
                {inviteMutation.isPending ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
