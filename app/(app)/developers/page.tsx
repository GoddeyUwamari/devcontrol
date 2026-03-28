'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, X, Copy, Check, Trash2,
  Eye, EyeOff,
  Github, Slack, Bell, Trello,
  Cloud, Database, Server, BarChart2, Activity, Mail,
} from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useEffect } from 'react'
import { toast } from 'sonner'
import developersService from '@/lib/services/developers.service'

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
  const demoMode = useDemoMode()
  const router = useRouter()

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
    {
      id: 'aws',
      name: 'AWS',
      description: 'Connect your AWS account for cost, security, and infrastructure visibility',
      status: demoMode ? 'connected' : 'disconnected',
      connectedAt: demoMode ? '2024-01-10T00:00:00Z' : null,
      icon: <Cloud size={20} />,
    },
    {
      id: 'datadog',
      name: 'Datadog',
      description: 'Sync metrics, traces, and alerts from your Datadog account',
      status: 'disconnected',
      connectedAt: null,
      icon: <BarChart2 size={20} />,
    },
    {
      id: 'terraform',
      name: 'Terraform',
      description: 'Track infrastructure-as-code changes and detect configuration drift',
      status: 'disconnected',
      connectedAt: null,
      icon: <Server size={20} />,
    },
    {
      id: 'kubernetes',
      name: 'Kubernetes',
      description: 'Monitor cluster health, resource efficiency, and container costs',
      status: 'disconnected',
      connectedAt: null,
      icon: <Database size={20} />,
    },
    {
      id: 'cloudwatch',
      name: 'CloudWatch',
      description: 'Monitor AWS resources and stream metrics, logs, and alarms into DevControl.',
      status: 'disconnected',
      connectedAt: null,
      icon: <Activity size={20} />,
    },
    {
      id: 'grafana',
      name: 'Grafana',
      description: 'Sync dashboards, alerts, and performance data from your Grafana instance.',
      status: 'disconnected',
      connectedAt: null,
      icon: <BarChart2 size={20} />,
    },
    {
      id: 'gitlab',
      name: 'GitLab',
      description: 'Pull merge request events and CI/CD pipeline data from your GitLab repositories.',
      status: 'disconnected',
      connectedAt: null,
      icon: <Github size={20} />,
    },
    {
      id: 'prometheus',
      name: 'Prometheus',
      description: 'Scrape metrics and monitor service health across your infrastructure in real time.',
      status: 'disconnected',
      connectedAt: null,
      icon: <Server size={20} />,
    },
    {
      id: 'newrelic',
      name: 'New Relic',
      description: 'Stream APM, error tracking, and infrastructure data from New Relic into DevControl.',
      status: 'disconnected',
      connectedAt: null,
      icon: <BarChart2 size={20} />,
    },
    {
      id: 'opsgenie',
      name: 'OpsGenie',
      description: 'Route critical alerts to on-call teams with escalation policies and schedules.',
      status: 'disconnected',
      connectedAt: null,
      icon: <Bell size={20} />,
    },
    {
      id: 'email',
      name: 'Email',
      description: 'Send alert notifications directly to your team via SMTP with custom recipients.',
      status: 'disconnected',
      connectedAt: null,
      icon: <Mail size={20} />,
    },
    {
      id: 'linear',
      name: 'Linear',
      description: 'Create and link issues in Linear automatically from alerts and anomaly detections.',
      status: 'disconnected',
      connectedAt: null,
      icon: <Trello size={20} />,
    },
  ])

  useEffect(() => {
    if (demoMode) return
    developersService.getKeys().then(data => setApiKeys(data as unknown as ApiKey[])).catch(() => {})
    developersService.getWebhooks().then(data => setWebhooks(data as unknown as WebhookEndpoint[])).catch(() => {})
  }, [demoMode])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleGenerateKey = async () => {
    if (!newKeyName.trim()) {
      setNewKeyError('Key name is required.')
      return
    }
    if (demoMode) {
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
      return
    }
    try {
      const key = await developersService.generateKey(newKeyName.trim())
      setApiKeys(k => [...k, { ...key, createdAt: key.created_at, lastUsedAt: key.last_used_at }])
      setGeneratedKey(key.raw_key ?? '')
      setNewKeyName('')
      setNewKeyError('')
      toast.success('API key generated')
    } catch (err: any) {
      setNewKeyError(err?.response?.data?.message ?? 'Failed to generate key')
    }
  }

  const handleRevokeKey = async (id: string) => {
    if (demoMode) {
      setApiKeys(k => k.filter(key => key.id !== id))
      return
    }
    try {
      await developersService.revokeKey(id)
      setApiKeys(k => k.filter(key => key.id !== id))
      toast.success('API key revoked')
    } catch {
      toast.error('Failed to revoke key')
    }
  }

  const handleCopy = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDeleteWebhook = async (id: string) => {
    if (demoMode) {
      setWebhooks(w => w.filter(wh => wh.id !== id))
      return
    }
    try {
      await developersService.deleteWebhook(id)
      setWebhooks(w => w.filter(wh => wh.id !== id))
      toast.success('Webhook deleted')
    } catch {
      toast.error('Failed to delete webhook')
    }
  }

  const handleAddWebhook = async () => {
    if (!webhookUrl.trim() || !webhookUrl.startsWith('https://')) {
      setWebhookError('A valid HTTPS URL is required.')
      return
    }
    if (demoMode) {
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
      return
    }
    try {
      const wh = await developersService.addWebhook(webhookUrl.trim())
      setWebhooks(w => [...w, { ...wh, createdAt: wh.created_at, lastTriggeredAt: wh.last_triggered_at }])
      setWebhookUrl('')
      setWebhookError('')
      setShowNewWebhook(false)
      toast.success('Webhook endpoint registered')
      if (wh.secret) toast.info(`Webhook secret: ${wh.secret} — save this now`)
    } catch (err: any) {
      setWebhookError(err?.response?.data?.message ?? 'Failed to register webhook')
    }
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

  const isAwsConnected = integrations.find(i => i.id === 'aws')?.status === 'connected'

  const handleConnect = (id: string) => {
    if (id === 'aws') { router.push('/connect-aws'); return }
    handleToggleIntegration(id)
  }

  const setupSteps = [
    {
      number: 1,
      title: 'Connect AWS',
      description: 'Unlock cost, security, and infrastructure insights',
      status: isAwsConnected ? 'connected' : 'pending',
      cta: isAwsConnected ? 'Connected ✓' : 'Connect AWS →',
      onClick: () => router.push('/connect-aws'),
    },
    {
      number: 2,
      title: 'Connect Observability',
      description: 'Sync metrics, traces, and performance data',
      status: 'pending' as const,
      cta: 'Connect Datadog →',
      onClick: () => handleConnect('datadog'),
    },
    {
      number: 3,
      title: 'Set up Alerts',
      description: 'Send real-time alerts to your team',
      status: 'pending' as const,
      cta: 'Connect Slack →',
      onClick: () => handleConnect('slack'),
    },
  ]

  const integrationGroups = [
    {
      label: 'Core infrastructure',
      items: ['aws', 'kubernetes', 'terraform', 'cloudwatch'],
    },
    {
      label: 'Observability',
      items: ['datadog', 'grafana', 'prometheus', 'newrelic'],
    },
    {
      label: 'Alerts & incidents',
      items: ['slack', 'pagerduty', 'opsgenie', 'email'],
    },
    {
      label: 'Dev workflow',
      items: ['github', 'jira', 'gitlab', 'linear'],
    },
  ]

  const integrationMeta: Record<string, { desc: string; recommended: boolean }> = {
    aws:        { desc: 'Connect your AWS account for cost, security, and infrastructure visibility', recommended: true },
    kubernetes: { desc: 'Monitor cluster health, resource efficiency, and container costs', recommended: false },
    terraform:  { desc: 'Track infrastructure-as-code changes and detect configuration drift', recommended: false },
    datadog:    { desc: 'Sync metrics, traces, and alerts from your Datadog account', recommended: true },
    slack:      { desc: 'Send real-time alerts and reports to your Slack channels', recommended: true },
    pagerduty:  { desc: 'Route critical alerts to on-call engineers instantly', recommended: false },
    github:     { desc: 'Pull deployment events and PR data from your repositories', recommended: false },
    jira:       { desc: 'Create and link incidents to Jira issues automatically', recommended: false },
    cloudwatch: { desc: 'Monitor AWS resources and stream metrics, logs, and alarms into DevControl.', recommended: false },
    grafana:    { desc: 'Sync dashboards, alerts, and performance data from your Grafana instance.', recommended: false },
    gitlab:     { desc: 'Pull merge request events and CI/CD pipeline data from your GitLab repositories.', recommended: false },
    prometheus: { desc: 'Scrape metrics and monitor service health across your infrastructure in real time.', recommended: false },
    newrelic:   { desc: 'Stream APM, error tracking, and infrastructure data from New Relic into DevControl.', recommended: false },
    opsgenie:   { desc: 'Route critical alerts to on-call teams with escalation policies and schedules.', recommended: false },
    email:      { desc: 'Send alert notifications directly to your team via SMTP with custom recipients.', recommended: false },
    linear:     { desc: 'Create and link issues in Linear automatically from alerts and anomaly detections.', recommended: false },
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '40px 56px 80px', maxWidth: '1400px', margin: '0 auto' }}>

      {/* PAGE HEADER */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{
          fontSize: '1.9rem',
          fontWeight: 700,
          color: '#0F172A',
          letterSpacing: '-0.025em',
          marginBottom: '6px',
          lineHeight: 1.2,
        }}>
          Integrations & API
        </h1>
        <p style={{ fontSize: '16px', color: '#334155', lineHeight: 1.5 }}>
          Connect your stack, ingest real-time data, and power insights across your infrastructure.
        </p>
      </div>

      {/* GET STARTED */}
      <div style={{ marginBottom: '28px' }}>
        <p style={{
          fontSize: '10px',
          fontWeight: 500,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          margin: '0 0 12px',
        }}>
          Get DevControl fully connected
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
          {setupSteps.map(step => (
            <div key={step.number} style={{
              background: '#FFFFFF',
              border: step.status === 'connected' ? '1px solid #059669' : '1px solid #E2E8F0',
              borderRadius: '12px',
              padding: '16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background: step.status === 'connected' ? '#059669' : '#534AB7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '15px',
                  color: '#fff',
                  fontWeight: 500,
                  flexShrink: 0,
                }}>
                  {step.status === 'connected' ? '✓' : step.number}
                </div>
                <p style={{ fontSize: '15px', fontWeight: 500, color: '#0F172A', margin: 0 }}>
                  {step.title}
                </p>
              </div>
              <p style={{ fontSize: '16px', color: '#64748B', margin: '0 0 12px', lineHeight: 1.4 }}>
                {step.description}
              </p>
              <button
                onClick={step.onClick}
                disabled={step.status === 'connected'}
                style={{
                  fontSize: '14px',
                  color: step.status === 'connected' ? '#059669' : 'white',
                  background: step.status === 'connected' ? 'none' : '#534AB7',
                  border: `1px solid ${step.status === 'connected' ? '#059669' : '#534AB7'}`,
                  borderRadius: '6px',
                  padding: '5px 10px',
                  cursor: step.status === 'connected' ? 'default' : 'pointer',
                  width: '100%',
                }}
              >
                {step.cta}
              </button>
            </div>
          ))}
        </div>
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
            fontSize: '15px',
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
              <span style={{ fontSize: '15px', fontWeight: 600, color: '#0F172A' }}>
                14,847 requests this month
              </span>
              <span style={{ fontSize: '15px', color: '#64748B' }}>
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
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#7C3AED', whiteSpace: 'nowrap' }}>
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
              fontSize: '15px',
              fontWeight: 700,
              color: '#334155',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: '4px',
            }}>
              API Keys
            </div>
            <div style={{ fontSize: '15px', color: '#64748B' }}>
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
              fontSize: '15px',
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
          <div style={{ textAlign: 'center', padding: '24px 20px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              background: '#EEEDFE',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px',
              fontSize: '18px',
            }}>
              🔑
            </div>
            <p style={{ fontSize: '16px', fontWeight: 500, color: '#0F172A', margin: '0 0 6px' }}>
              No API keys yet
            </p>
            <p style={{
              fontSize: '16px',
              color: '#64748B',
              margin: '0 0 16px',
              lineHeight: 1.5,
              maxWidth: '320px',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}>
              Generate an API key to integrate DevControl into your internal tools, CI/CD pipelines, and workflows.
            </p>
            <button
              onClick={() => setShowNewKey(true)}
              style={{
                background: '#534AB7',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '15px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              + Generate API Key
            </button>
          </div>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1.5fr 2fr 1fr 80px',
              gap: '12px',
              padding: '0 0 10px',
              borderBottom: '1px solid #F1F5F9',
              fontSize: '16px',
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
                <span style={{ fontSize: '15px', fontWeight: 600, color: '#0F172A' }}>
                  {key.name}
                </span>
                <code style={{
                  fontSize: '15px',
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
                      fontSize: '16px',
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
                <span style={{ fontSize: '15px', color: '#64748B' }}>
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
                    fontSize: '16px',
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
            <p style={{ fontSize: '15px', fontWeight: 600, color: '#059669', marginBottom: '10px' }}>
              ✓ Key generated — copy it now. It will not be shown again.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <code style={{
                flex: 1,
                fontSize: '15px',
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
                  fontSize: '15px',
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
              fontSize: '15px',
              fontWeight: 700,
              color: '#334155',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: '4px',
            }}>
              Webhooks
            </div>
            <div style={{ fontSize: '15px', color: '#64748B' }}>
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
              fontSize: '15px',
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
          <div style={{ textAlign: 'center', padding: '24px 20px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              background: '#EEEDFE',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px',
              fontSize: '18px',
            }}>
              ⚡
            </div>
            <p style={{ fontSize: '16px', fontWeight: 500, color: '#0F172A', margin: '0 0 6px' }}>
              No webhooks configured
            </p>
            <p style={{
              fontSize: '16px',
              color: '#64748B',
              margin: '0 0 16px',
              lineHeight: 1.5,
              maxWidth: '320px',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}>
              Add a webhook endpoint to stream real-time events — alerts, cost changes, deployments — directly to your systems.
            </p>
            <button
              onClick={() => setShowNewWebhook(true)}
              style={{
                background: '#534AB7',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '15px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              + Add Endpoint
            </button>
          </div>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '3fr 2fr 80px 100px',
              gap: '12px',
              padding: '0 0 10px',
              borderBottom: '1px solid #F1F5F9',
              fontSize: '16px',
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
                  fontSize: '15px',
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
                      fontSize: '16px',
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
                <span style={{ fontSize: '15px', color: '#64748B' }}>
                  {wh.lastTriggeredAt ? timeAgo(wh.lastTriggeredAt) : 'Never'}
                </span>
                <div style={{ textAlign: 'center' }}>
                  <span style={{
                    fontSize: '16px',
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
                  <button
                    onClick={() => handleDeleteWebhook(wh.id)}
                    style={{ background: 'none', border: '1px solid #FECACA', borderRadius: '6px',
                      padding: '4px 10px', fontSize: '0.875rem', fontWeight: 600, color: '#DC2626',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Trash2 size={11} /> Delete
                  </button>
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
          fontSize: '15px',
          fontWeight: 700,
          color: '#334155',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '24px',
        }}>
          Integrations
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          {integrationGroups.map(group => (
            <div key={group.label}>
              <p style={{
                fontSize: '10px',
                fontWeight: 500,
                color: '#6b7280',
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                margin: '0 0 12px',
              }}>
                {group.label}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {group.items.map(id => {
                  const intg = integrations.find(i => i.id === id)
                  if (!intg) return null
                  const meta = integrationMeta[id]
                  const isConnected = intg.status === 'connected'
                  return (
                    <div key={id} style={{
                      background: '#FFFFFF',
                      border: isConnected ? '1px solid #059669' : '1px solid #E2E8F0',
                      borderRadius: '12px',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            width: '32px',
                            height: '32px',
                            background: isConnected ? '#F0FDF4' : '#F8FAFC',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isConnected ? '#059669' : '#64748B',
                            flexShrink: 0,
                          }}>
                            {intg.icon}
                          </div>
                          <p style={{ fontSize: '15px', fontWeight: 500, color: '#0F172A', margin: 0 }}>
                            {intg.name}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          {meta?.recommended && !isConnected && (
                            <span style={{
                              fontSize: 10,
                              fontWeight: 500,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: '#EEEDFE',
                              color: '#3C3489',
                              border: '0.5px solid #AFA9EC',
                            }}>
                              Recommended
                            </span>
                          )}
                          {isConnected && (
                            <span style={{
                              fontSize: '16px',
                              fontWeight: 500,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: '#F0FDF4',
                              color: '#166534',
                            }}>
                              Connected
                            </span>
                          )}
                        </div>
                      </div>
                      <p style={{ fontSize: '16px', color: '#64748B', margin: 0, lineHeight: 1.4 }}>
                        {meta?.desc ?? intg.description}
                      </p>
                      <button
                        onClick={() => {
                          if (id === 'aws' && !isConnected) { router.push('/connect-aws'); return }
                          handleToggleIntegration(id)
                        }}
                        style={{
                          marginTop: '4px',
                          fontSize: 11,
                          color: isConnected ? '#059669' : '#534AB7',
                          background: isConnected ? 'none' : '#EEEDFE',
                          border: isConnected ? '1px solid #059669' : 'none',
                          borderRadius: 4,
                          padding: '5px 12px',
                          cursor: 'pointer',
                          alignSelf: 'flex-start',
                        }}
                      >
                        {isConnected ? 'Manage →' : 'Connect →'}
                      </button>
                    </div>
                  )
                })}
              </div>
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
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em' }}>
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
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
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
                  fontSize: '15px',
                  color: '#0F172A',
                  outline: 'none',
                  boxSizing: 'border-box',
                  background: '#FAFAFA',
                }}
                onFocus={e => { e.target.style.border = '1px solid #7C3AED'; e.target.style.background = '#FFFFFF' }}
                onBlur={e => { e.target.style.border = '1px solid #E2E8F0'; e.target.style.background = '#FAFAFA' }}
              />
              {newKeyError && (
                <p style={{ fontSize: '15px', color: '#DC2626', marginTop: '6px' }}>{newKeyError}</p>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => { setShowNewKey(false); setNewKeyError(''); setNewKeyName('') }}
                style={{
                  flex: 1, padding: '10px', background: '#F8FAFC',
                  border: '1px solid #E2E8F0', borderRadius: '9px',
                  fontSize: '15px', fontWeight: 600, color: '#334155', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateKey}
                style={{
                  flex: 1, padding: '10px', background: '#7C3AED',
                  border: 'none', borderRadius: '9px',
                  fontSize: '15px', fontWeight: 600, color: '#fff', cursor: 'pointer',
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
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em' }}>
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
              <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
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
                  fontSize: '15px',
                  color: '#0F172A',
                  outline: 'none',
                  boxSizing: 'border-box',
                  background: '#FAFAFA',
                }}
                onFocus={e => { e.target.style.border = '1px solid #7C3AED'; e.target.style.background = '#FFFFFF' }}
                onBlur={e => { e.target.style.border = '1px solid #E2E8F0'; e.target.style.background = '#FAFAFA' }}
              />
              {webhookError && (
                <p style={{ fontSize: '15px', color: '#DC2626', marginTop: '6px' }}>{webhookError}</p>
              )}
              <p style={{ fontSize: '16px', color: '#64748B', marginTop: '6px' }}>
                Must be a valid HTTPS URL. DevControl will POST JSON payloads to this endpoint.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => { setShowNewWebhook(false); setWebhookError(''); setWebhookUrl('') }}
                style={{
                  flex: 1, padding: '10px', background: '#F8FAFC',
                  border: '1px solid #E2E8F0', borderRadius: '9px',
                  fontSize: '15px', fontWeight: 600, color: '#334155', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddWebhook}
                style={{
                  flex: 1, padding: '10px', background: '#7C3AED',
                  border: 'none', borderRadius: '9px',
                  fontSize: '15px', fontWeight: 600, color: '#fff', cursor: 'pointer',
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
