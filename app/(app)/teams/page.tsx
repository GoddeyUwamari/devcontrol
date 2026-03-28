'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Users, Plus, X, Slack, Trash2, AlertTriangle } from 'lucide-react'
import { teamsService } from '@/lib/services/teams.service'
import type { Team, CreateTeamPayload } from '@/lib/types'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'

const DEMO_TEAMS: Team[] = [
  {
    id: 'team-1',
    name: 'Platform Engineering',
    description: 'Core infrastructure, CI/CD, and DevOps',
    members: ['u1', 'u2', 'u3', 'u4', 'u5'],
    slackChannel: '#platform-eng',
    owner: 'Sarah Chen',
    createdAt: '2024-01-15T00:00:00Z',
    updatedAt: '2024-03-01T00:00:00Z',
  },
  {
    id: 'team-2',
    name: 'Backend Services',
    description: 'APIs, microservices, and data layer',
    members: ['u6', 'u7', 'u8', 'u9', 'u10', 'u11', 'u12'],
    slackChannel: '#backend',
    owner: 'Marcus Rivera',
    createdAt: '2024-01-20T00:00:00Z',
    updatedAt: '2024-03-10T00:00:00Z',
  },
  {
    id: 'team-3',
    name: 'Frontend',
    description: 'Web applications and design system',
    members: ['u13', 'u14', 'u15', 'u16', 'u17', 'u18'],
    slackChannel: '#frontend',
    owner: 'Priya Nair',
    createdAt: '2024-02-01T00:00:00Z',
    updatedAt: '2024-03-12T00:00:00Z',
  },
  {
    id: 'team-4',
    name: 'Data & Analytics',
    description: 'Data pipelines, warehousing, and BI',
    members: ['u19', 'u20', 'u21', 'u22'],
    slackChannel: '#data-team',
    owner: 'James Wu',
    createdAt: '2024-02-10T00:00:00Z',
    updatedAt: '2024-03-08T00:00:00Z',
  },
  {
    id: 'team-5',
    name: 'Security',
    description: 'Security, compliance, and IAM governance',
    members: ['u23', 'u24', 'u25'],
    slackChannel: '#security',
    owner: 'Leila Hassan',
    createdAt: '2024-02-15T00:00:00Z',
    updatedAt: '2024-03-05T00:00:00Z',
  },
]

// Demo metadata per team
const DEMO_META: Record<string, { services: number; cost: string; alerts: number }> = {
  'team-1': { services: 12, cost: '$4,820/mo', alerts: 2 },
  'team-2': { services: 31, cost: '$18,340/mo', alerts: 5 },
  'team-3': { services: 8,  cost: '$1,960/mo', alerts: 0 },
  'team-4': { services: 17, cost: '$9,150/mo', alerts: 1 },
  'team-5': { services: 6,  cost: '$2,210/mo', alerts: 3 },
}

export default function TeamsPage() {
  const router = useRouter()
  const demoMode = useDemoMode()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<{
    name: string
    description: string
    slackChannel: string
    owner: string
  }>({ name: '', description: '', slackChannel: '', owner: '' })
  const [formError, setFormError] = useState('')

  const { data: teamsData, isLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: teamsService.getAll,
    enabled: !demoMode,
  })
  const teams = teamsData ?? []

  const displayTeams = demoMode ? DEMO_TEAMS : teams

  const createMutation = useMutation({
    mutationFn: (payload: CreateTeamPayload) => teamsService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      setShowCreate(false)
      setForm({ name: '', description: '', slackChannel: '', owner: '' })
      setFormError('')
    },
    onError: () => {
      setFormError('Failed to create team. Please try again.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: teamsService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
    },
  })

  const handleCreate = () => {
    if (!form.name.trim()) {
      setFormError('Team name is required.')
      return
    }
    if (!form.owner.trim()) {
      setFormError('Owner is required.')
      return
    }
    createMutation.mutate({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      slackChannel: form.slackChannel.trim() || undefined,
      owner: form.owner.trim(),
    })
  }

  return (
    <div style={{
      padding: '40px 56px 80px',
      maxWidth: '1400px',
      margin: '0 auto',
    }}>

      {/* ── PAGE HEADER ── */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '32px',
      }}>
        <div>
          <h1 style={{
            fontSize: '1.9rem',
            fontWeight: 700,
            color: '#0F172A',
            letterSpacing: '-0.025em',
            marginBottom: '6px',
            lineHeight: 1.2,
          }}>
            Teams &amp; Ownership
          </h1>
          <p style={{
            fontSize: '16px',
            color: '#475569',
            lineHeight: 1.5,
          }}>
            Assign responsibility across services, costs, and infrastructure across your organization.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: '#7C3AED',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: '9px',
            fontSize: '15px',
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(124,58,237,0.25)',
            whiteSpace: 'nowrap',
          }}
        >
          <Plus size={15} />
          {displayTeams.length === 0 ? '+ Create Your First Team' : '+ Create Team'}
        </button>
      </div>

      {/* ── LOADING ── */}
      {isLoading && !demoMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{
              background: '#F8FAFC',
              borderRadius: '12px',
              height: '56px',
              border: '1px solid #F1F5F9',
              animation: 'pulse 2s infinite',
            }} />
          ))}
        </div>
      )}

      {/* ── EMPTY STATE ── */}
      {!isLoading && displayTeams.length === 0 && (
        <>
          {/* AI insight banner */}
          <div style={{
            background: '#F5F3FF',
            border: '1px solid #DDD6FE',
            borderLeft: '4px solid #534AB7',
            borderRadius: '10px',
            padding: '14px 18px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
          }}>
            <span style={{ fontSize: '18px', flexShrink: 0 }}>✦</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#1E1B4B', marginBottom: '3px' }}>
                Teams unlock cost attribution and ownership clarity
              </div>
              <div style={{ fontSize: '13px', color: '#4C1D95', lineHeight: 1.5 }}>
                Platforms without team ownership spend 3× longer resolving incidents and have 40% higher unattributed cloud spend. Create teams to map services, costs, and alerts to the right groups.
              </div>
            </div>
          </div>

          {/* Empty state card */}
          <div style={{
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: '16px',
            padding: '56px 40px',
            textAlign: 'center',
            maxWidth: '520px',
            margin: '0 auto',
          }}>
            <div style={{
              width: '60px',
              height: '60px',
              background: '#EEEDFE',
              borderRadius: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
            }}>
              <Users size={26} style={{ color: '#534AB7' }} />
            </div>
            <h2 style={{
              fontSize: '1.3rem',
              fontWeight: 700,
              color: '#0F172A',
              marginBottom: '10px',
              letterSpacing: '-0.01em',
            }}>
              No teams yet
            </h2>
            <p style={{
              fontSize: '15px',
              color: '#64748B',
              lineHeight: 1.6,
              marginBottom: '28px',
            }}>
              Create your first team to start attributing services, costs, and alerts to the right groups.
            </p>

            {/* Feature bullets */}
            <div style={{
              textAlign: 'left',
              marginBottom: '28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}>
              {[
                'Map cloud services and infrastructure to owning teams',
                'Track monthly cost per team with automatic attribution',
                'Route alerts and incidents to the right on-call group',
                'Measure team-level compliance posture and risk score',
              ].map((item) => (
                <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#7C3AED',
                    flexShrink: 0,
                    marginTop: '6px',
                  }} />
                  <span style={{ fontSize: '14px', color: '#374151', lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowCreate(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                background: '#7C3AED',
                color: '#fff',
                padding: '11px 28px',
                borderRadius: '9px',
                fontSize: '15px',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(124,58,237,0.2)',
              }}
            >
              <Plus size={15} />
              Create Your First Team
            </button>
          </div>
        </>
      )}

      {/* ── TEAMS TABLE ── */}
      {displayTeams.length > 0 && (
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: '14px',
          overflow: 'hidden',
        }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 100px 100px 140px 120px 160px 100px',
            padding: '11px 20px',
            background: '#F8FAFC',
            borderBottom: '1px solid #E2E8F0',
            gap: '16px',
          }}>
            {['Team', 'Members', 'Services', 'Monthly Cost', 'Active Alerts', 'Owner', 'Actions'].map((col) => (
              <div key={col} style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#64748B',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}>
                {col}
              </div>
            ))}
          </div>

          {/* Table rows */}
          {displayTeams.map((team, idx) => {
            const meta = DEMO_META[team.id]
            const memberCount = (team.members ?? []).length
            const services = demoMode && meta ? meta.services : null
            const cost = demoMode && meta ? meta.cost : null
            const alerts = demoMode && meta ? meta.alerts : null
            const initials = (team.name ?? '?')
              .split(' ')
              .map((w: string) => w[0])
              .filter(Boolean)
              .slice(0, 2)
              .join('')
              .toUpperCase()

            return (
              <div
                key={team.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 100px 100px 140px 120px 160px 100px',
                  padding: '16px 20px',
                  borderBottom: idx < displayTeams.length - 1 ? '1px solid #F1F5F9' : 'none',
                  gap: '16px',
                  alignItems: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#FAFBFF' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {/* Team name + description */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <div style={{
                    width: '36px',
                    height: '36px',
                    background: '#F5F3FF',
                    borderRadius: '9px',
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
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#0F172A',
                      letterSpacing: '-0.01em',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {team.name}
                    </div>
                    {team.description && (
                      <div style={{
                        fontSize: '12px',
                        color: '#94A3B8',
                        marginTop: '2px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {team.description}
                      </div>
                    )}
                  </div>
                </div>

                {/* Members */}
                <div style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: memberCount === 0 ? '#9ca3af' : '#0F172A',
                }}>
                  {memberCount === 0 ? '—' : memberCount}
                </div>

                {/* Services */}
                <div style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: services === null ? '#9ca3af' : '#0F172A',
                }}>
                  {services === null ? '—' : services}
                </div>

                {/* Monthly Cost */}
                <div style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: cost === null ? '#9ca3af' : '#0F172A',
                }}>
                  {cost === null ? '—' : cost}
                </div>

                {/* Active Alerts */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {alerts === null ? (
                    <span style={{ fontSize: '14px', color: '#9ca3af' }}>—</span>
                  ) : alerts === 0 ? (
                    <span style={{ fontSize: '14px', color: '#9ca3af' }}>0</span>
                  ) : (
                    <>
                      <AlertTriangle size={13} style={{ color: alerts >= 3 ? '#DC2626' : '#D97706', flexShrink: 0 }} />
                      <span style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: alerts >= 3 ? '#DC2626' : '#D97706',
                      }}>
                        {alerts}
                      </span>
                    </>
                  )}
                </div>

                {/* Owner */}
                <div style={{
                  fontSize: '13px',
                  color: '#475569',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {team.owner || <span style={{ color: '#9ca3af' }}>—</span>}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => router.push('/teams')}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#7C3AED',
                      cursor: 'pointer',
                      padding: '4px 0',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    View →
                  </button>
                  {!demoMode && (
                    <button
                      onClick={() => deleteMutation.mutate(team.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#CBD5E1',
                        padding: '4px',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#DC2626' }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#CBD5E1' }}
                      title="Delete team"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* Footer */}
          <div style={{
            padding: '12px 20px',
            background: '#F8FAFC',
            borderTop: '1px solid #F1F5F9',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            {displayTeams.some(t => t.slackChannel) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#94A3B8', fontSize: '12px' }}>
                <Slack size={12} />
                Slack channels linked
              </div>
            )}
            <span style={{ fontSize: '12px', color: '#94A3B8', marginLeft: 'auto' }}>
              {displayTeams.length} team{displayTeams.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}

      {/* ── CREATE TEAM MODAL ── */}
      {showCreate && (
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
            maxWidth: '480px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.15)',
          }}>
            {/* Modal header */}
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
                Create Team
              </h2>
              <button
                onClick={() => {
                  setShowCreate(false)
                  setFormError('')
                  setForm({ name: '', description: '', slackChannel: '', owner: '' })
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#94A3B8',
                  display: 'flex',
                  padding: '4px',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Form fields */}
            {([
              {
                label: 'Team Name',
                key: 'name',
                placeholder: 'e.g. Platform Engineering',
                required: true,
              },
              {
                label: 'Description',
                key: 'description',
                placeholder: 'What does this team own?',
                required: false,
              },
              {
                label: 'Owner',
                key: 'owner',
                placeholder: 'e.g. user-id or email',
                required: true,
              },
              {
                label: 'Slack Channel',
                key: 'slackChannel',
                placeholder: 'e.g. #platform-eng',
                required: false,
              },
            ] as const).map(({ label, key, placeholder, required }) => (
              <div key={key} style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: '6px',
                }}>
                  {label}
                  {required && (
                    <span style={{ color: '#DC2626', marginLeft: '3px' }}>*</span>
                  )}
                </label>
                <input
                  type="text"
                  value={form[key]}
                  onChange={e => {
                    setForm(f => ({ ...f, [key]: e.target.value }))
                    setFormError('')
                  }}
                  placeholder={placeholder}
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
            ))}

            {/* Error */}
            {formError && (
              <p style={{
                fontSize: '12px',
                color: '#DC2626',
                marginBottom: '16px',
              }}>
                {formError}
              </p>
            )}

            {/* Actions */}
            <div style={{
              display: 'flex',
              gap: '10px',
              marginTop: '8px',
            }}>
              <button
                onClick={() => {
                  setShowCreate(false)
                  setFormError('')
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: '9px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#7C3AED',
                  border: 'none',
                  borderRadius: '9px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#fff',
                  cursor: createMutation.isPending ? 'not-allowed' : 'pointer',
                  opacity: createMutation.isPending ? 0.7 : 1,
                }}
              >
                {createMutation.isPending ? 'Creating…' : 'Create Team'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
