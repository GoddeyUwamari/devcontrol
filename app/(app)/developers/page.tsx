'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Copy, Check, Trash2, Eye, EyeOff, Github, Slack, Bell, Trello, Cloud, Database, Server, BarChart2, Activity, Mail } from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { toast } from 'sonner'
import developersService from '@/lib/services/developers.service'

interface ApiKey { id: string; name: string; prefix: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; status: 'active' | 'revoked' }
interface WebhookEndpoint { id: string; url: string; events: string[]; status: 'active' | 'failing' | 'disabled'; lastTriggeredAt: string | null; createdAt: string }
interface Integration { id: string; name: string; description: string; status: 'connected' | 'disconnected'; connectedAt: string | null; icon: React.ReactNode }

const DEMO_API_KEYS: ApiKey[] = [
  { id: 'key-1', name: 'Production CI/CD',   prefix: 'dc_live_k8x2', scopes: ['read:metrics', 'read:costs', 'read:security'], createdAt: '2024-01-15T00:00:00Z', lastUsedAt: '2024-03-17T14:22:00Z', status: 'active' },
  { id: 'key-2', name: 'Grafana Dashboard',  prefix: 'dc_live_m3p9', scopes: ['read:metrics'],                               createdAt: '2024-02-01T00:00:00Z', lastUsedAt: '2024-03-18T09:11:00Z', status: 'active' },
  { id: 'key-3', name: 'Internal Reporting', prefix: 'dc_live_q7r1', scopes: ['read:costs', 'read:deployments'],             createdAt: '2024-02-20T00:00:00Z', lastUsedAt: null,                   status: 'active' },
]

const DEMO_WEBHOOKS: WebhookEndpoint[] = [
  { id: 'wh-1', url: 'https://hooks.slack.com/services/T0.../B0.../xxx',   events: ['alert.triggered', 'cost.threshold_exceeded'], status: 'active',  lastTriggeredAt: '2024-03-17T16:45:00Z', createdAt: '2024-01-20T00:00:00Z' },
  { id: 'wh-2', url: 'https://api.pagerduty.com/webhooks/v3/xxx',          events: ['incident.created', 'alert.critical'],          status: 'active',  lastTriggeredAt: '2024-03-15T02:11:00Z', createdAt: '2024-02-05T00:00:00Z' },
  { id: 'wh-3', url: 'https://internal.wayup.com/devcontrol/webhook',      events: ['deployment.completed', 'security.violation'],  status: 'failing', lastTriggeredAt: '2024-03-10T11:30:00Z', createdAt: '2024-03-01T00:00:00Z' },
]

function formatDate(iso: string) { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) }
function timeAgo(iso: string) { const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000); if (h < 1) return 'just now'; if (h < 24) return `${h}h ago`; const d = Math.floor(h / 24); return d < 30 ? `${d}d ago` : formatDate(iso) }

const integrationMeta: Record<string, { desc: string; recommended: boolean }> = {
  aws:        { desc: 'Connect your AWS account for cost, security, and infrastructure visibility', recommended: true  },
  kubernetes: { desc: 'Monitor cluster health, resource efficiency, and container costs',           recommended: false },
  terraform:  { desc: 'Track infrastructure-as-code changes and detect configuration drift',        recommended: false },
  cloudwatch: { desc: 'Monitor AWS resources and stream metrics, logs, and alarms into DevControl', recommended: false },
  datadog:    { desc: 'Sync metrics, traces, and alerts from your Datadog account',                 recommended: true  },
  grafana:    { desc: 'Sync dashboards, alerts, and performance data from your Grafana instance',   recommended: false },
  prometheus: { desc: 'Scrape metrics and monitor service health across your infrastructure',        recommended: false },
  newrelic:   { desc: 'Stream APM, error tracking, and infrastructure data from New Relic',         recommended: false },
  slack:      { desc: 'Send real-time alerts and reports to your Slack channels',                   recommended: true  },
  pagerduty:  { desc: 'Route critical alerts to on-call engineers instantly',                        recommended: false },
  opsgenie:   { desc: 'Route critical alerts to on-call teams with escalation policies',             recommended: false },
  email:      { desc: 'Send alert notifications directly to your team via SMTP',                     recommended: false },
  github:     { desc: 'Pull deployment events and PR data from your repositories',                   recommended: false },
  jira:       { desc: 'Create and link incidents to Jira issues automatically',                      recommended: false },
  gitlab:     { desc: 'Pull merge request events and CI/CD pipeline data from GitLab',              recommended: false },
  linear:     { desc: 'Create and link issues in Linear automatically from alerts',                  recommended: false },
}

const integrationGroups = [
  { label: 'Core infrastructure', items: ['aws', 'kubernetes', 'terraform', 'cloudwatch'] },
  { label: 'Observability',       items: ['datadog', 'grafana', 'prometheus', 'newrelic'] },
  { label: 'Alerts & incidents',  items: ['slack', 'pagerduty', 'opsgenie', 'email'] },
  { label: 'Dev workflow',        items: ['github', 'jira', 'gitlab', 'linear'] },
]

const INITIAL_INTEGRATIONS = (demoMode: boolean): Integration[] => [
  { id: 'aws',        name: 'AWS',         description: '', status: demoMode ? 'connected' : 'disconnected', connectedAt: demoMode ? '2024-01-10T00:00:00Z' : null, icon: <Cloud size={18} /> },
  { id: 'kubernetes', name: 'Kubernetes',  description: '', status: 'disconnected', connectedAt: null, icon: <Database size={18} /> },
  { id: 'terraform',  name: 'Terraform',   description: '', status: 'disconnected', connectedAt: null, icon: <Server size={18} /> },
  { id: 'cloudwatch', name: 'CloudWatch',  description: '', status: 'disconnected', connectedAt: null, icon: <Activity size={18} /> },
  { id: 'datadog',    name: 'Datadog',     description: '', status: 'disconnected', connectedAt: null, icon: <BarChart2 size={18} /> },
  { id: 'grafana',    name: 'Grafana',     description: '', status: 'disconnected', connectedAt: null, icon: <BarChart2 size={18} /> },
  { id: 'prometheus', name: 'Prometheus',  description: '', status: 'disconnected', connectedAt: null, icon: <Server size={18} /> },
  { id: 'newrelic',   name: 'New Relic',   description: '', status: 'disconnected', connectedAt: null, icon: <BarChart2 size={18} /> },
  { id: 'slack',      name: 'Slack',       description: '', status: demoMode ? 'connected' : 'disconnected', connectedAt: demoMode ? '2024-01-20T00:00:00Z' : null, icon: <Slack size={18} /> },
  { id: 'pagerduty',  name: 'PagerDuty',   description: '', status: demoMode ? 'connected' : 'disconnected', connectedAt: demoMode ? '2024-02-01T00:00:00Z' : null, icon: <Bell size={18} /> },
  { id: 'opsgenie',   name: 'OpsGenie',    description: '', status: 'disconnected', connectedAt: null, icon: <Bell size={18} /> },
  { id: 'email',      name: 'Email',       description: '', status: 'disconnected', connectedAt: null, icon: <Mail size={18} /> },
  { id: 'github',     name: 'GitHub',      description: '', status: demoMode ? 'connected' : 'disconnected', connectedAt: demoMode ? '2024-01-15T00:00:00Z' : null, icon: <Github size={18} /> },
  { id: 'jira',       name: 'Jira',        description: '', status: 'disconnected', connectedAt: null, icon: <Trello size={18} /> },
  { id: 'gitlab',     name: 'GitLab',      description: '', status: 'disconnected', connectedAt: null, icon: <Github size={18} /> },
  { id: 'linear',     name: 'Linear',      description: '', status: 'disconnected', connectedAt: null, icon: <Trello size={18} /> },
]

export default function DevelopersPage() {
  const demoMode = useDemoMode()
  const router = useRouter()

  const [apiKeys, setApiKeys] = useState<ApiKey[]>(demoMode ? DEMO_API_KEYS : [])
  const [showNewKey, setShowNewKey] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyError, setNewKeyError] = useState('')
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>(demoMode ? DEMO_WEBHOOKS : [])
  const [showNewWebhook, setShowNewWebhook] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookError, setWebhookError] = useState('')

  const [integrations, setIntegrations] = useState<Integration[]>(() => INITIAL_INTEGRATIONS(demoMode))

  useEffect(() => {
    if (demoMode) return
    developersService.getKeys().then(d => setApiKeys(d as any)).catch(() => {})
    developersService.getWebhooks().then(d => setWebhooks(d as any)).catch(() => {})
  }, [demoMode])

  const handleGenerateKey = async () => {
    if (!newKeyName.trim()) { setNewKeyError('Key name is required.'); return }
    if (demoMode) {
      const fakeKey = 'dc_live_' + Math.random().toString(36).substring(2, 18)
      setApiKeys(k => [...k, { id: 'key-' + Date.now(), name: newKeyName.trim(), prefix: fakeKey.substring(0, 12), scopes: ['read:metrics', 'read:costs'], createdAt: new Date().toISOString(), lastUsedAt: null, status: 'active' }])
      setGeneratedKey(fakeKey); setNewKeyName(''); setNewKeyError(''); return
    }
    try { const key = await developersService.generateKey(newKeyName.trim()); setApiKeys(k => [...k, { ...key, createdAt: key.created_at, lastUsedAt: key.last_used_at }]); setGeneratedKey(key.raw_key ?? ''); setNewKeyName(''); setNewKeyError(''); toast.success('API key generated') }
    catch (err: any) { setNewKeyError(err?.response?.data?.message ?? 'Failed to generate key') }
  }

  const handleRevokeKey = async (id: string) => {
    if (demoMode) { setApiKeys(k => k.filter(key => key.id !== id)); return }
    try { await developersService.revokeKey(id); setApiKeys(k => k.filter(key => key.id !== id)); toast.success('API key revoked') }
    catch { toast.error('Failed to revoke key') }
  }

  const handleCopy = () => { if (generatedKey) { navigator.clipboard.writeText(generatedKey); setCopied(true); setTimeout(() => setCopied(false), 2000) } }

  const handleDeleteWebhook = async (id: string) => {
    if (demoMode) { setWebhooks(w => w.filter(wh => wh.id !== id)); return }
    try { await developersService.deleteWebhook(id); setWebhooks(w => w.filter(wh => wh.id !== id)); toast.success('Webhook deleted') }
    catch { toast.error('Failed to delete webhook') }
  }

  const handleAddWebhook = async () => {
    if (!webhookUrl.trim() || !webhookUrl.startsWith('https://')) { setWebhookError('A valid HTTPS URL is required.'); return }
    if (demoMode) { setWebhooks(w => [...w, { id: 'wh-' + Date.now(), url: webhookUrl.trim(), events: ['alert.triggered'], status: 'active', lastTriggeredAt: null, createdAt: new Date().toISOString() }]); setWebhookUrl(''); setWebhookError(''); setShowNewWebhook(false); return }
    try { const wh = await developersService.addWebhook(webhookUrl.trim()); setWebhooks(w => [...w, { ...wh, createdAt: wh.created_at, lastTriggeredAt: wh.last_triggered_at }]); setWebhookUrl(''); setWebhookError(''); setShowNewWebhook(false); toast.success('Webhook endpoint registered'); if (wh.secret) toast.info(`Webhook secret: ${wh.secret} — save this now`) }
    catch (err: any) { setWebhookError(err?.response?.data?.message ?? 'Failed to register webhook') }
  }

  const handleToggleIntegration = (id: string) => setIntegrations(list => list.map(i => i.id === id ? { ...i, status: i.status === 'connected' ? 'disconnected' : 'connected', connectedAt: i.status === 'connected' ? null : new Date().toISOString() } : i))
  const handleConnect = (id: string) => { if (id === 'aws') { router.push('/connect-aws'); return }; handleToggleIntegration(id) }
  const isAwsConnected = integrations.find(i => i.id === 'aws')?.status === 'connected'

  const setupSteps = [
    { number: 1, title: 'Connect AWS',           description: 'Unlock cost, security, and infrastructure insights', status: isAwsConnected ? 'connected' : 'pending', cta: isAwsConnected ? 'Connected ✓' : 'Connect AWS →',    onClick: () => router.push('/connect-aws') },
    { number: 2, title: 'Connect Observability', description: 'Sync metrics, traces, and performance data',         status: 'pending' as const,                       cta: 'Connect Datadog →', onClick: () => handleConnect('datadog') },
    { number: 3, title: 'Set up Alerts',         description: 'Send real-time alerts to your team',                 status: 'pending' as const,                       cta: 'Connect Slack →',   onClick: () => handleConnect('slack') },
  ]

  const closeKeyModal = () => { setShowNewKey(false); setNewKeyError(''); setNewKeyName(''); setGeneratedKey(null) }
  const closeWebhookModal = () => { setShowNewWebhook(false); setWebhookError(''); setWebhookUrl('') }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1400px] mx-auto">

      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5">Integrations &amp; API</h1>
        <p className="text-sm text-slate-500 leading-relaxed">Connect your stack, ingest real-time data, and power insights across your infrastructure.</p>
      </div>

      {/* Get started */}
      <div className="mb-7">
        <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mb-3">Get DevControl fully connected</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {setupSteps.map(step => (
            <div key={step.number} className={`bg-white border rounded-xl p-4 ${step.status === 'connected' ? 'border-green-500' : 'border-slate-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0 ${step.status === 'connected' ? 'bg-green-600' : 'bg-violet-700'}`}>{step.status === 'connected' ? '✓' : step.number}</div>
                <p className="text-sm font-medium text-slate-900">{step.title}</p>
              </div>
              <p className="text-xs text-slate-500 mb-3 leading-relaxed">{step.description}</p>
              <button onClick={step.onClick} disabled={step.status === 'connected'}
                className={`w-full text-xs rounded-lg py-1.5 border transition-colors ${step.status === 'connected' ? 'text-green-600 border-green-500 bg-transparent cursor-default' : 'text-white bg-violet-700 hover:bg-violet-800 border-violet-700 cursor-pointer'}`}>
                {step.cta}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* API Usage bar */}
      {demoMode && (
        <div className="bg-white border border-slate-200 rounded-2xl px-5 sm:px-7 py-4 mb-5 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">API Usage</p>
          <div className="flex-1">
            <div className="flex justify-between mb-1.5">
              <span className="text-sm font-semibold text-slate-900">14,847 requests this month</span>
              <span className="text-xs text-slate-400">of 20,000 included</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full"><div className="w-[74%] h-full bg-violet-600 rounded-full" /></div>
          </div>
          <span className="text-sm font-bold text-violet-600 whitespace-nowrap">74% used</span>
        </div>
      )}

      {/* API Keys */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">API Keys</p>
            <p className="text-xs text-slate-400">{apiKeys.length} active key{apiKeys.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => setShowNewKey(true)} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-lg text-xs font-semibold border-none cursor-pointer transition-colors whitespace-nowrap self-start sm:self-auto">
            <Plus size={13} /> Generate Key
          </button>
        </div>

        {apiKeys.length === 0 ? (
          <div className="text-center py-6">
            <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center mx-auto mb-3 text-lg">🔑</div>
            <p className="text-sm font-medium text-slate-900 mb-1.5">No API keys yet</p>
            <p className="text-xs text-slate-500 leading-relaxed mb-4 max-w-xs mx-auto">Generate an API key to integrate DevControl into your CI/CD pipelines and internal tools.</p>
            <button onClick={() => setShowNewKey(true)} className="bg-violet-700 hover:bg-violet-800 text-white border-none rounded-lg px-4 py-2 text-xs font-medium cursor-pointer transition-colors">+ Generate API Key</button>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <div className="grid pb-2.5 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-widest min-w-[580px]" style={{ gridTemplateColumns: '2fr 1.5fr 2fr 1fr 70px', gap: '12px' }}>
                <span>Name</span><span>Key prefix</span><span>Scopes</span><span>Last used</span><span />
              </div>
              {apiKeys.map(key => (
                <div key={key.id} className="grid py-3 border-b border-slate-50 last:border-0 items-center min-w-[580px]" style={{ gridTemplateColumns: '2fr 1.5fr 2fr 1fr 70px', gap: '12px' }}>
                  <span className="text-sm font-semibold text-slate-900">{key.name}</span>
                  <code className="text-xs font-mono text-slate-600 bg-slate-50 px-2 py-0.5 rounded">{key.prefix}••••••••</code>
                  <div className="flex gap-1 flex-wrap">{key.scopes.map(s => <span key={s} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">{s}</span>)}</div>
                  <span className="text-xs text-slate-400">{key.lastUsedAt ? timeAgo(key.lastUsedAt) : 'Never'}</span>
                  <button onClick={() => handleRevokeKey(key.id)} className="flex items-center gap-1 bg-transparent border border-red-200 rounded-lg px-2 py-1 text-[10px] font-semibold text-red-600 cursor-pointer hover:bg-red-50 transition-colors">
                    <Trash2 size={10} /> Revoke
                  </button>
                </div>
              ))}
            </div>
            {/* Mobile cards */}
            <div className="sm:hidden flex flex-col divide-y divide-slate-50">
              {apiKeys.map(key => (
                <div key={key.id} className="py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold text-slate-900">{key.name}</span>
                    <button onClick={() => handleRevokeKey(key.id)} className="flex items-center gap-1 bg-transparent border border-red-200 rounded px-2 py-0.5 text-[10px] font-semibold text-red-600 cursor-pointer"><Trash2 size={9} /> Revoke</button>
                  </div>
                  <code className="text-[11px] font-mono text-slate-500 block mb-1.5">{key.prefix}••••••••</code>
                  <div className="flex flex-wrap gap-1">{key.scopes.map(s => <span key={s} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">{s}</span>)}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Generated key reveal */}
        {generatedKey && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-xl px-4 py-4">
            <p className="text-xs font-semibold text-green-600 mb-2.5">✓ Key generated — copy it now. It will not be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-slate-900 bg-white px-3 py-2 rounded-lg border border-green-200 overflow-hidden text-ellipsis">{showKey ? generatedKey : '•'.repeat(generatedKey.length)}</code>
              <button onClick={() => setShowKey(v => !v)} className="bg-transparent border-none cursor-pointer text-slate-400 p-1">{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              <button onClick={handleCopy} className={`flex items-center gap-1.5 text-white border-none rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer transition-colors ${copied ? 'bg-green-600' : 'bg-violet-600 hover:bg-violet-700'}`}>
                {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
              <button onClick={() => setGeneratedKey(null)} className="bg-transparent border-none cursor-pointer text-slate-300 p-1"><X size={14} /></button>
            </div>
          </div>
        )}
      </div>

      {/* Webhooks */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Webhooks</p>
            <p className="text-xs text-slate-400">{webhooks.length} endpoint{webhooks.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => setShowNewWebhook(true)} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-lg text-xs font-semibold border-none cursor-pointer transition-colors whitespace-nowrap self-start sm:self-auto">
            <Plus size={13} /> Add Endpoint
          </button>
        </div>

        {webhooks.length === 0 ? (
          <div className="text-center py-6">
            <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center mx-auto mb-3 text-lg">⚡</div>
            <p className="text-sm font-medium text-slate-900 mb-1.5">No webhooks configured</p>
            <p className="text-xs text-slate-500 leading-relaxed mb-4 max-w-xs mx-auto">Add a webhook endpoint to stream real-time events — alerts, cost changes, deployments — directly to your systems.</p>
            <button onClick={() => setShowNewWebhook(true)} className="bg-violet-700 hover:bg-violet-800 text-white border-none rounded-lg px-4 py-2 text-xs font-medium cursor-pointer transition-colors">+ Add Endpoint</button>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <div className="grid pb-2.5 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-widest min-w-[560px]" style={{ gridTemplateColumns: '3fr 2fr 80px 90px', gap: '12px' }}>
                <span>Endpoint URL</span><span>Events</span><span>Last fired</span><span className="text-center">Status</span>
              </div>
              {webhooks.map(wh => (
                <div key={wh.id} className="grid py-3 border-b border-slate-50 last:border-0 items-center min-w-[560px]" style={{ gridTemplateColumns: '3fr 2fr 80px 90px', gap: '12px' }}>
                  <code className="text-xs font-mono text-slate-600 truncate">{wh.url}</code>
                  <div className="flex flex-wrap gap-1">{wh.events.map(e => <span key={e} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-50 text-slate-500">{e}</span>)}</div>
                  <span className="text-xs text-slate-400">{wh.lastTriggeredAt ? timeAgo(wh.lastTriggeredAt) : 'Never'}</span>
                  <div className="flex flex-col items-center gap-1.5">
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full capitalize ${wh.status === 'active' ? 'bg-green-50 text-green-600' : wh.status === 'failing' ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-400'}`}>{wh.status}</span>
                    <button onClick={() => handleDeleteWebhook(wh.id)} className="flex items-center gap-1 bg-transparent border border-red-200 rounded px-2 py-0.5 text-[10px] font-semibold text-red-600 cursor-pointer hover:bg-red-50 transition-colors"><Trash2 size={9} /> Delete</button>
                  </div>
                </div>
              ))}
            </div>
            {/* Mobile cards */}
            <div className="sm:hidden flex flex-col divide-y divide-slate-50">
              {webhooks.map(wh => (
                <div key={wh.id} className="py-3">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <code className="text-[11px] font-mono text-slate-500 truncate flex-1">{wh.url}</code>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize shrink-0 ${wh.status === 'active' ? 'bg-green-50 text-green-600' : wh.status === 'failing' ? 'bg-red-50 text-red-600' : 'bg-slate-50 text-slate-400'}`}>{wh.status}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">{wh.events.map(e => <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-400">{e}</span>)}</div>
                  <button onClick={() => handleDeleteWebhook(wh.id)} className="flex items-center gap-1 bg-transparent border border-red-200 rounded px-2 py-1 text-[10px] font-semibold text-red-600 cursor-pointer"><Trash2 size={9} /> Delete</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Integrations */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-7">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">Integrations</p>
        <div className="flex flex-col gap-7">
          {integrationGroups.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest mb-3">{group.label}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {group.items.map(id => {
                  const intg = integrations.find(i => i.id === id)
                  if (!intg) return null
                  const meta = integrationMeta[id]
                  const isConnected = intg.status === 'connected'
                  return (
                    <div key={id} className={`bg-white border rounded-xl p-4 flex flex-col gap-2 ${isConnected ? 'border-green-500' : 'border-slate-200'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isConnected ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-400'}`}>{intg.icon}</div>
                          <p className="text-sm font-medium text-slate-900">{intg.name}</p>
                        </div>
                        {meta?.recommended && !isConnected && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 shrink-0 whitespace-nowrap">Recommended</span>}
                        {isConnected && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-50 text-green-700 shrink-0">Connected</span>}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed flex-1">{meta?.desc ?? intg.description}</p>
                      <button onClick={() => { if (id === 'aws' && !isConnected) { router.push('/connect-aws'); return }; handleToggleIntegration(id) }}
                        className={`text-[11px] rounded px-3 py-1.5 cursor-pointer self-start transition-colors border ${isConnected ? 'text-green-600 border-green-500 bg-transparent hover:bg-green-50' : 'text-violet-700 bg-violet-50 border-transparent hover:bg-violet-100'}`}>
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

      {/* Generate Key Modal */}
      {showNewKey && (
        <div className="fixed inset-0 bg-slate-900/50 flex sm:items-center items-end justify-center z-50 px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-2xl p-5 sm:p-8 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-bold text-slate-900">Generate API Key</h2>
              <button onClick={closeKeyModal} className="bg-transparent border-none cursor-pointer text-slate-300 hover:text-slate-600 p-1 transition-colors"><X size={16} /></button>
            </div>
            <div className="mb-5">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Key name <span className="text-red-600">*</span></label>
              <input type="text" value={newKeyName} onChange={e => { setNewKeyName(e.target.value); setNewKeyError('') }} placeholder="e.g. Production CI/CD"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-xs text-slate-900 bg-slate-50 outline-none focus:border-violet-600 focus:bg-white transition-colors box-border" />
              {newKeyError && <p className="text-[11px] text-red-600 mt-1.5">{newKeyError}</p>}
            </div>
            <div className="flex gap-2.5">
              <button onClick={closeKeyModal} className="flex-1 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 cursor-pointer hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={handleGenerateKey} className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 border-none rounded-xl text-xs font-semibold text-white cursor-pointer transition-colors">Generate</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Webhook Modal */}
      {showNewWebhook && (
        <div className="fixed inset-0 bg-slate-900/50 flex sm:items-center items-end justify-center z-50 px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-2xl p-5 sm:p-8 w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-bold text-slate-900">Add Webhook Endpoint</h2>
              <button onClick={closeWebhookModal} className="bg-transparent border-none cursor-pointer text-slate-300 hover:text-slate-600 p-1 transition-colors"><X size={16} /></button>
            </div>
            <div className="mb-5">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Endpoint URL <span className="text-red-600">*</span></label>
              <input type="url" value={webhookUrl} onChange={e => { setWebhookUrl(e.target.value); setWebhookError('') }} placeholder="https://your-server.com/webhook"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-xs text-slate-900 bg-slate-50 outline-none focus:border-violet-600 focus:bg-white transition-colors box-border" />
              {webhookError && <p className="text-[11px] text-red-600 mt-1.5">{webhookError}</p>}
              <p className="text-[11px] text-slate-400 mt-1.5">Must be a valid HTTPS URL. DevControl will POST JSON payloads to this endpoint.</p>
            </div>
            <div className="flex gap-2.5">
              <button onClick={closeWebhookModal} className="flex-1 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500 cursor-pointer hover:bg-slate-100 transition-colors">Cancel</button>
              <button onClick={handleAddWebhook} className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 border-none rounded-xl text-xs font-semibold text-white cursor-pointer transition-colors">Add Endpoint</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}