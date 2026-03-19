'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, X, ChevronRight, Slack, Trash2 } from 'lucide-react'
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
    owner: 'u1',
    createdAt: '2024-01-15T00:00:00Z',
    updatedAt: '2024-03-01T00:00:00Z',
  },
  {
    id: 'team-2',
    name: 'Backend Services',
    description: 'APIs, microservices, and data layer',
    members: ['u6', 'u7', 'u8', 'u9', 'u10', 'u11', 'u12'],
    slackChannel: '#backend',
    owner: 'u6',
    createdAt: '2024-01-20T00:00:00Z',
    updatedAt: '2024-03-10T00:00:00Z',
  },
  {
    id: 'team-3',
    name: 'Frontend',
    description: 'Web applications and design system',
    members: ['u13', 'u14', 'u15', 'u16', 'u17', 'u18'],
    slackChannel: '#frontend',
    owner: 'u13',
    createdAt: '2024-02-01T00:00:00Z',
    updatedAt: '2024-03-12T00:00:00Z',
  },
  {
    id: 'team-4',
    name: 'Data & Analytics',
    description: 'Data pipelines, warehousing, and BI',
    members: ['u19', 'u20', 'u21', 'u22'],
    slackChannel: '#data-team',
    owner: 'u19',
    createdAt: '2024-02-10T00:00:00Z',
    updatedAt: '2024-03-08T00:00:00Z',
  },
  {
    id: 'team-5',
    name: 'Security',
    description: 'Security, compliance, and IAM governance',
    members: ['u23', 'u24', 'u25'],
    slackChannel: '#security',
    owner: 'u23',
    createdAt: '2024-02-15T00:00:00Z',
    updatedAt: '2024-03-05T00:00:00Z',
  },
]

export default function TeamsPage() {
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
            fontSize: '1.7rem',
            fontWeight: 700,
            color: '#0F172A',
            letterSpacing: '-0.025em',
            marginBottom: '6px',
            lineHeight: 1.2,
          }}>
            Teams
          </h1>
          <p style={{
            fontSize: '14px',
            color: '#475569',
            lineHeight: 1.5,
          }}>
            Manage team ownership, members, and service attribution.
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
            fontSize: '13px',
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(124,58,237,0.25)',
          }}
        >
          <Plus size={15} />
          Create Team
        </button>
      </div>

      {/* ── LOADING ── */}
      {isLoading && !demoMode && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '20px',
        }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{
              background: '#F8FAFC',
              borderRadius: '12px',
              height: '160px',
              border: '1px solid #F1F5F9',
              animation: 'pulse 2s infinite',
            }} />
          ))}
        </div>
      )}

      {/* ── EMPTY STATE ── */}
      {!isLoading && displayTeams.length === 0 && (
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #F1F5F9',
          borderRadius: '16px',
          padding: '64px 40px',
          textAlign: 'center',
          maxWidth: '480px',
          margin: '0 auto',
        }}>
          <div style={{
            width: '56px',
            height: '56px',
            background: '#F5F3FF',
            borderRadius: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <Users size={24} style={{ color: '#7C3AED' }} />
          </div>
          <h2 style={{
            fontSize: '1.1rem',
            fontWeight: 700,
            color: '#0F172A',
            marginBottom: '8px',
            letterSpacing: '-0.01em',
          }}>
            No teams yet
          </h2>
          <p style={{
            fontSize: '14px',
            color: '#64748B',
            lineHeight: 1.6,
            marginBottom: '24px',
          }}>
            Create your first team to start attributing services, costs, and
            performance metrics to the right groups.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: '#7C3AED',
              color: '#fff',
              padding: '10px 24px',
              borderRadius: '9px',
              fontSize: '13px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <Plus size={15} />
            Create your first team
          </button>
        </div>
      )}

      {/* ── TEAMS GRID ── */}
      {displayTeams.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '20px',
        }}>
          {displayTeams.map((team) => (
            <div
              key={team.id}
              style={{
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '16px',
                padding: '24px',
                position: 'relative',
                transition: 'box-shadow 0.15s',
                cursor: 'default',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.07)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              {/* Team avatar + name */}
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    background: '#F5F3FF',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#7C3AED',
                    flexShrink: 0,
                  }}>
                    {(team.name ?? '?')
                      .split(' ')
                      .map((w: string) => w[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()}
                  </div>
                  <div>
                    <div style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: '#0F172A',
                      letterSpacing: '-0.01em',
                    }}>
                      {team.name}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: '#94A3B8',
                      marginTop: '2px',
                    }}>
                      {(team.members ?? []).length}{(team.members ?? []).length === 1 ? ' member' : ' members'}
                    </div>
                  </div>
                </div>

                {/* Delete button — hidden in demo mode */}
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
                    onMouseEnter={e => {
                      e.currentTarget.style.color = '#DC2626'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = '#CBD5E1'
                    }}
                    title="Delete team"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {/* Description */}
              {team.description && (
                <p style={{
                  fontSize: '13px',
                  color: '#475569',
                  lineHeight: 1.55,
                  marginBottom: '16px',
                }}>
                  {team.description}
                </p>
              )}

              {/* Slack channel */}
              {team.slackChannel && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  color: '#64748B',
                  marginBottom: '16px',
                }}>
                  <Slack size={12} />
                  {team.slackChannel}
                </div>
              )}

              {/* Footer — owner + view */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '14px',
                borderTop: '1px solid #F1F5F9',
                marginTop: 'auto',
              }}>
                <span style={{
                  fontSize: '11px',
                  color: '#94A3B8',
                }}>
                  Owner: {team.owner}
                </span>
                <button style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  background: 'none',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#7C3AED',
                  cursor: 'pointer',
                  padding: 0,
                }}>
                  View
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          ))}
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
