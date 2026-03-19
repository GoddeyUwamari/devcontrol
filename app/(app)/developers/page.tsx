'use client'

import { useState } from 'react'
import {
  Plus, X, Copy, Check, Trash2,
  Eye, EyeOff,
  Github, Slack, Bell, Trello,
} from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'

// ── LOCAL TYPES ────────────────────────────────────────────────────────────────

interface ApiKey {
  id: string
  name: string
  prefix: string
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
  status: 'active' | 'revoked'
}

interface WebhookEndpoint {
  id: string
  url: string
  events: string[]
  status: 'active' | 'failing' | 'disabled'
  lastTriggeredAt: string | null
  createdAt: string
}

interface Integration {
  id: string
  name: string
  description: string
  status: 'connected' | 'disconnected'
  connectedAt: string | null
  icon: React.ReactNode
}

// ── DEMO DATA ──────────────────────────────────────────────────────────────────

const DEMO_API_KEYS: ApiKey[] = [
  {
    id: 'key-1',
    name: 'Production CI/CD',
    prefix: 'dc_live_k8x2',
    scopes: ['read:metrics', 'read:costs', 'read:security'],
    createdAt: '2024-01-15T00:00:00Z',
    lastUsedAt: '2024-03-17T14:22:00Z',
    status: 'active',
  },
  {
    id: 'key-2',
    name: 'Grafana Dashboard',
    prefix: 'dc_live_m3p9',
    scopes: ['read:metrics'],
    createdAt: '2024-02-01T00:00:00Z',
    lastUsedAt: '2024-03-18T09:11:00Z',
    status: 'active',
  },
  {
    id: 'key-3',
    name: 'Internal Reporting',
    prefix: 'dc_live_q7r1',
    scopes: ['read:costs', 'read:deployments'],
    createdAt: '2024-02-20T00:00:00Z',
    lastUsedAt: null,
    status: 'active',
  },
]

const DEMO_WEBHOOKS: WebhookEndpoint[] = [
  {
    id: 'wh-1',
    url: 'https://hooks.slack.com/services/T0.../B0.../xxx',
    events: ['alert.triggered', 'cost.threshold_exceeded'],
    status: 'active',
    lastTriggeredAt: '2024-03-17T16:45:00Z',
    createdAt: '2024-01-20T00:00:00Z',
  },
  {
    id: 'wh-2',
    url: 'https://api.pagerduty.com/webhooks/v3/xxx',
    events: ['incident.created', 'alert.critical'],
    status: 'active',
    lastTriggeredAt: '2024-03-15T02:11:00Z',
    createdAt: '2024-02-05T00:00:00Z',
  },
  {
    id: 'wh-3',
    url: 'https://internal.wayup.com/devcontrol/webhook',
    events: ['deployment.completed', 'security.violation'],
    status: 'failing',
    lastTriggeredAt: '2024-03-10T11:30:00Z',
    createdAt: '2024-03-01T00:00:00Z',
  },
]

// ── HELPERS ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 1000 / 60 / 60)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return formatDate(iso)
}

// ── PAGE ───────────────────────────────────────────────────────────────────────

export default function DevelopersPage() {
  const { demoMode } = useDemoMode()

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(demoMode ? DEMO_API_KEYS : [])
  const [showNewKey, setShowNewKey] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyError, setNewKeyError] = useState('')
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  // Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>(demoMode ? DEMO_WEBHOOKS : [])
  const [showNewWebhook, setShowNewWebhook] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookError, setWebhookError] = useState('')

  // Integrations state
  const [integrations, setIntegrations] = useState<Integration[]>([
    {
      id: 'github',
      name: 'GitHub',
      description: 'Pull deployment events and PR data from your repositories',
      status: demoMode ? 'connected' : 'disconnected',
      connectedAt: demoMode ? '2024-01-15T00:00:00Z' : null,
      icon: <Github size={20} />,
    },
    {
      id: 'slack',
      name: 'Slack',
      description: 'Send alerts and reports to your Slack channels',
      status: demoMode ? 'connected' : 'disconnected',
      connectedAt: demoMode ? '2024-01-20T00:00:00Z' : null,
      icon: <Slack size={20} />,
    },
    {
      id: 'pagerduty',
      name: 'PagerDuty',
      description: 'Route critical alerts to on-call engineers instantly',
      status: demoMode ? 'connected' : 'disconnected',
      connectedAt: demoMode ? '2024-02-01T00:00:00Z' : null,
      icon: <Bell size={20} />,
    },
    {
      id: 'jira',
      name: 'Jira',
      description: 'Create and link incidents to Jira issues automatically',
      status: 'disconnected',
      connectedAt: null,
      icon: <Trello size={20} />,
    },
  ])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleGenerateKey = () => {
    if (!newKeyName.trim()) {
      setNewKeyError('Key name is required.')
      return
    }
    const fakeKey = 'dc_live_' + Math.random().toString(36).substring(2, 18)
    const newKey: ApiKey = {
      id: 'key-' + Date.now(),
      name: newKeyName.trim(),
      prefix: fakeKey.substring(0, 12),
      scopes: ['read:metrics', 'read:costs'],
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      status: 'active',
    }
    setApiKeys(k => [...k, newKey])
    setGeneratedKey(fakeKey)
    setNewKeyName('')
    setNewKeyError('')
  }

  const handleRevokeKey = (id: string) => {
    setApiKeys(k => k.filter(key => key.id !== id))
  }

  const handleCopy = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleAddWebhook = () => {
    if (!webhookUrl.trim() || !webhookUrl.startsWith('https://')) {
      setWebhookError('A valid HTTPS URL is required.')
      return
    }
    const newWh: WebhookEndpoint = {
      id: 'wh-' + Date.now(),
      url: webhookUrl.trim(),
      events: ['alert.triggered'],
      status: 'active',
      lastTriggeredAt: null,
      createdAt: new Date().toISOString(),
    }
    setWebhooks(w => [...w, newWh])
    setWebhookUrl('')
    setWebhookError('')
    setShowNewWebhook(false)
  }

  const handleToggleIntegration = (id: string) => {
    setIntegrations(list =>
      list.map(i =>
        i.id === id
          ? {
              ...i,
              status: i.status === 'connected' ? 'disconnected' : 'connected',
              connectedAt: i.status === 'connected' ? null : new Date().toISOString(),
            }
          : i
      )
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

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
          Developers
        </h1>
        <p style={{ fontSize: '14px', color: '#334155', lineHeight: 1.5 }}>
          API keys, webhooks, and integrations.
        </p>
      </div>

      {/* API USAGE BAR */}
      {demoMode && (
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: '16px',
          padding: '20px 28px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
        }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#334155',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            whiteSpace: 'nowrap',
          }}>
            API Usage
          </div>
          <div style={{ flex: 1 }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '6px',
            }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>
                14,847 requests this month
              </span>
              <span style={{ fontSize: '13px', color: '#64748B' }}>
                of 20,000 included
              </span>
            </div>
            <div style={{ height: '6px', background: '#F1F5F9', borderRadius: '3px' }}>
              <div style={{
                width: '74%',
                height: '100%',
                background: '#7C3AED',
                borderRadius: '3px',
              }} />
            </div>
          </div>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#7C3AED', whiteSpace: 'nowrap' }}>
            74% used
          </span>
        </div>
      )}

      {/* API KEYS */}
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
              API Keys
            </div>
            <div style={{ fontSize: '13px', color: '#64748B' }}>
              {apiKeys.length} active key{apiKeys.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            onClick={() => setShowNewKey(true)}
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
            Generate Key
          </button>
        </div>

        {apiKeys.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#64748B', fontSize: '14px' }}>
            No API keys yet. Generate your first key to get started.
          </div>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1.5fr 2fr 1fr 80px',
              gap: '12px',
              padding: '0 0 10px',
              borderBottom: '1px solid #F1F5F9',
              fontSize: '12px',
              fontWeight: 700,
              color: '#64748B',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              <span>Name</span>
              <span>Key prefix</span>
              <span>Scopes</span>
              <span>Last used</span>
              <span />
            </div>

            {apiKeys.map(key => (
              <div key={key.id} style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1.5fr 2fr 1fr 80px',
                gap: '12px',
                padding: '12px 0',
                borderBottom: '1px solid #F1F5F9',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0F172A' }}>
                  {key.name}
                </span>
                <code style={{
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  color: '#334155',
                  background: '#F8FAFC',
                  padding: '3px 8px',
                  borderRadius: '5px',
                }}>
                  {key.prefix}••••••••
                </code>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {key.scopes.map(s => (
                    <span key={s} style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: '#F5F3FF',
                      color: '#7C3AED',
                    }}>
                      {s}
                    </span>
                  ))}
                </div>
                <span style={{ fontSize: '13px', color: '#64748B' }}>
                  {key.lastUsedAt ? timeAgo(key.lastUsedAt) : 'Never'}
                </span>
                <button
                  onClick={() => handleRevokeKey(key.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: 'none',
                    border: '1px solid #FECACA',
                    borderRadius: '6px',
                    padding: '5px 10px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#DC2626',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={11} />
                  Revoke
                </button>
              </div>
            ))}
          </>
        )}

        {/* Generated key reveal */}
        {generatedKey && (
          <div style={{
            marginTop: '16px',
            background: '#F0FDF4',
            border: '1px solid #A7F3D0',
            borderRadius: '10px',
            padding: '16px 20px',
          }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#059669', marginBottom: '10px' }}>
              ✓ Key generated — copy it now. It will not be shown again.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <code style={{
                flex: 1,
                fontSize: '13px',
                fontFamily: 'monospace',
                color: '#0F172A',
                background: '#FFFFFF',
                padding: '8px 12px',
                borderRadius: '7px',
                border: '1px solid #D1FAE5',
                letterSpacing: '0.05em',
              }}>
                {showKey ? generatedKey : '•'.repeat(generatedKey.length)}
              </code>
              <button
                onClick={() => setShowKey(v => !v)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748B',
                  display: 'flex',
                  padding: '4px',
                }}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button
                onClick={handleCopy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: copied ? '#059669' : '#7C3AED',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '7px',
                  padding: '8px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
              </button>
              <button
                onClick={() => setGeneratedKey(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748B',
                  display: 'flex',
                  padding: '4px',
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* WEBHOOKS */}
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
              Webhooks
            </div>
            <div style={{ fontSize: '13px', color: '#64748B' }}>
              {webhooks.length} endpoint{webhooks.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            onClick={() => setShowNewWebhook(true)}
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
            Add Endpoint
          </button>
        </div>

        {webhooks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#64748B', fontSize: '14px' }}>
            No webhook endpoints configured.
          </div>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '3fr 2fr 80px 100px',
              gap: '12px',
              padding: '0 0 10px',
              borderBottom: '1px solid #F1F5F9',
              fontSize: '12px',
              fontWeight: 700,
              color: '#64748B',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              <span>Endpoint URL</span>
              <span>Events</span>
              <span>Last fired</span>
              <span style={{ textAlign: 'center' }}>Status</span>
            </div>

            {webhooks.map(wh => (
              <div key={wh.id} style={{
                display: 'grid',
                gridTemplateColumns: '3fr 2fr 80px 100px',
                gap: '12px',
                padding: '12px 0',
                borderBottom: '1px solid #F1F5F9',
                alignItems: 'center',
              }}>
                <code style={{
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  color: '#334155',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {wh.url}
                </code>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {wh.events.map(e => (
                    <span key={e} style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: '#F8FAFC',
                      color: '#334155',
                    }}>
                      {e}
                    </span>
                  ))}
                </div>
                <span style={{ fontSize: '13px', color: '#64748B' }}>
                  {wh.lastTriggeredAt ? timeAgo(wh.lastTriggeredAt) : 'Never'}
                </span>
                <div style={{ textAlign: 'center' }}>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '3px 10px',
                    borderRadius: '99px',
                    background:
                      wh.status === 'active' ? '#ECFDF5'
                      : wh.status === 'failing' ? '#FEF2F2'
                      : '#F8FAFC',
                    color:
                      wh.status === 'active' ? '#059669'
                      : wh.status === 'failing' ? '#DC2626'
                      : '#64748B',
                    textTransform: 'capitalize',
                  }}>
                    {wh.status}
                  </span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* INTEGRATIONS */}
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
          Integrations
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '16px',
        }}>
          {integrations.map(intg => (
            <div key={intg.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '18px 20px',
              border: `1px solid ${intg.status === 'connected' ? '#DDD6FE' : '#F1F5F9'}`,
              borderRadius: '12px',
              background: intg.status === 'connected' ? '#FAFAF9' : '#FFFFFF',
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                background: intg.status === 'connected' ? '#F5F3FF' : '#F8FAFC',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: intg.status === 'connected' ? '#7C3AED' : '#64748B',
                flexShrink: 0,
              }}>
                {intg.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A', marginBottom: '2px' }}>
                  {intg.name}
                </div>
                <div style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.4 }}>
                  {intg.status === 'connected'
                    ? `Connected ${intg.connectedAt ? formatDate(intg.connectedAt) : ''}`
                    : intg.description}
                </div>
              </div>
              <button
                onClick={() => handleToggleIntegration(intg.id)}
                style={{
                  padding: '7px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: intg.status === 'connected' ? '1px solid #FECACA' : '1px solid #7C3AED',
                  background: intg.status === 'connected' ? '#FEF2F2' : '#7C3AED',
                  color: intg.status === 'connected' ? '#DC2626' : '#FFFFFF',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {intg.status === 'connected' ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* GENERATE KEY MODAL */}
      {showNewKey && (
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
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em' }}>
                Generate API Key
              </h2>
              <button
                onClick={() => { setShowNewKey(false); setNewKeyError(''); setNewKeyName(''); setGeneratedKey(null) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', display: 'flex', padding: '4px' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                Key name <span style={{ color: '#DC2626', marginLeft: '3px' }}>*</span>
              </label>
              <input
                type="text"
                value={newKeyName}
                onChange={e => { setNewKeyName(e.target.value); setNewKeyError('') }}
                placeholder="e.g. Production CI/CD"
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
                onFocus={e => { e.target.style.border = '1px solid #7C3AED'; e.target.style.background = '#FFFFFF' }}
                onBlur={e => { e.target.style.border = '1px solid #E2E8F0'; e.target.style.background = '#FAFAFA' }}
              />
              {newKeyError && (
                <p style={{ fontSize: '13px', color: '#DC2626', marginTop: '6px' }}>{newKeyError}</p>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => { setShowNewKey(false); setNewKeyError(''); setNewKeyName('') }}
                style={{
                  flex: 1, padding: '10px', background: '#F8FAFC',
                  border: '1px solid #E2E8F0', borderRadius: '9px',
                  fontSize: '13px', fontWeight: 600, color: '#334155', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateKey}
                style={{
                  flex: 1, padding: '10px', background: '#7C3AED',
                  border: 'none', borderRadius: '9px',
                  fontSize: '13px', fontWeight: 600, color: '#fff', cursor: 'pointer',
                }}
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD WEBHOOK MODAL */}
      {showNewWebhook && (
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
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '24px',
            }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em' }}>
                Add Webhook Endpoint
              </h2>
              <button
                onClick={() => { setShowNewWebhook(false); setWebhookError(''); setWebhookUrl('') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', display: 'flex', padding: '4px' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                Endpoint URL <span style={{ color: '#DC2626', marginLeft: '3px' }}>*</span>
              </label>
              <input
                type="url"
                value={webhookUrl}
                onChange={e => { setWebhookUrl(e.target.value); setWebhookError('') }}
                placeholder="https://your-server.com/webhook"
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
                onFocus={e => { e.target.style.border = '1px solid #7C3AED'; e.target.style.background = '#FFFFFF' }}
                onBlur={e => { e.target.style.border = '1px solid #E2E8F0'; e.target.style.background = '#FAFAFA' }}
              />
              {webhookError && (
                <p style={{ fontSize: '13px', color: '#DC2626', marginTop: '6px' }}>{webhookError}</p>
              )}
              <p style={{ fontSize: '12px', color: '#64748B', marginTop: '6px' }}>
                Must be a valid HTTPS URL. DevControl will POST JSON payloads to this endpoint.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => { setShowNewWebhook(false); setWebhookError(''); setWebhookUrl('') }}
                style={{
                  flex: 1, padding: '10px', background: '#F8FAFC',
                  border: '1px solid #E2E8F0', borderRadius: '9px',
                  fontSize: '13px', fontWeight: 600, color: '#334155', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddWebhook}
                style={{
                  flex: 1, padding: '10px', background: '#7C3AED',
                  border: 'none', borderRadius: '9px',
                  fontSize: '13px', fontWeight: 600, color: '#fff', cursor: 'pointer',
                }}
              >
                Add Endpoint
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
