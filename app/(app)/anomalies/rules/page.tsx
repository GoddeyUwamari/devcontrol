'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePlan } from '@/lib/hooks/use-plan'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import customAnomalyRulesService, {
  CustomAnomalyRule, CreateRulePayload
} from '@/lib/services/custom-anomaly-rules.service'
import {
  Plus, Trash2, Lock, SlidersHorizontal,
  ToggleLeft, ToggleRight, AlertTriangle,
  DollarSign, Activity, Clock, ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

// ── Demo data ─────────────────────────────────────────────────────────────────

const DEMO_RULES: CustomAnomalyRule[] = [
  {
    id: '1', organizationId: 'demo',
    name: 'EC2 Cost Spike',
    description: 'Alert when EC2 costs increase by more than 25% in a day',
    metric: 'ec2_cost', condition: 'percent_change_up',
    threshold: 25, timeWindow: '24h', severity: 'critical',
    enabled: true, createdAt: '2026-04-01T00:00:00Z', updatedAt: '2026-04-01T00:00:00Z',
  },
  {
    id: '2', organizationId: 'demo',
    name: 'Total Spend Threshold',
    description: 'Alert when total monthly spend exceeds $10,000',
    metric: 'total_cost', condition: 'greater_than',
    threshold: 10000, timeWindow: '30d', severity: 'warning',
    enabled: true, createdAt: '2026-04-02T00:00:00Z', updatedAt: '2026-04-02T00:00:00Z',
  },
  {
    id: '3', organizationId: 'demo',
    name: 'RDS CPU Overload',
    description: 'Alert when RDS CPU utilization drops below 10% for 2 hours',
    metric: 'rds_cpu', condition: 'less_than',
    threshold: 10, timeWindow: '2h', severity: 'info',
    enabled: false, createdAt: '2026-04-03T00:00:00Z', updatedAt: '2026-04-03T00:00:00Z',
  },
]

const METRIC_OPTIONS = [
  { value: 'total_cost',   label: 'Total AWS Cost',     icon: DollarSign },
  { value: 'ec2_cost',     label: 'EC2 Cost',           icon: DollarSign },
  { value: 'rds_cost',     label: 'RDS Cost',           icon: DollarSign },
  { value: 'lambda_cost',  label: 'Lambda Cost',        icon: DollarSign },
  { value: 'ec2_cpu',      label: 'EC2 CPU Usage',      icon: Activity   },
  { value: 'rds_cpu',      label: 'RDS CPU Usage',      icon: Activity   },
  { value: 'error_rate',   label: 'Error Rate',         icon: AlertTriangle },
  { value: 'response_time',label: 'Response Time (ms)', icon: Clock      },
]

const CONDITION_OPTIONS = [
  { value: 'greater_than',       label: 'Greater than'       },
  { value: 'less_than',          label: 'Less than'          },
  { value: 'percent_change_up',  label: '% increase over'    },
  { value: 'percent_change_down',label: '% decrease over'    },
]

const TIME_WINDOW_OPTIONS = [
  { value: '1h',  label: '1 hour'   },
  { value: '6h',  label: '6 hours'  },
  { value: '12h', label: '12 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d',  label: '7 days'   },
  { value: '30d', label: '30 days'  },
]

const SEVERITY_CONFIG = {
  critical: { color: '#DC2626', bg: '#FEF2F2', border: '#FEE2E2', label: 'Critical' },
  warning:  { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'Warning'  },
  info:     { color: '#64748B', bg: '#F8FAFC', border: '#F1F5F9', label: 'Info'     },
}

const DEFAULT_RULE: CreateRulePayload = {
  name: '', description: '', metric: 'total_cost',
  condition: 'greater_than', threshold: 0,
  timeWindow: '24h', severity: 'warning',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function conditionLabel(rule: CustomAnomalyRule): string {
  const cond = CONDITION_OPTIONS.find(c => c.value === rule.condition)?.label ?? rule.condition
  const unit = rule.condition.includes('percent') ? '%' : ''
  const metric = METRIC_OPTIONS.find(m => m.value === rule.metric)?.label ?? rule.metric
  return `${metric} ${cond} ${rule.threshold}${unit} over ${rule.timeWindow}`
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AnomalyRulesPage() {
  const { isEnterprise } = usePlan()
  const demoMode = useDemoMode()
  const { enabled: salesDemo } = useSalesDemo()
  const isDemoActive = demoMode || salesDemo

  const [rules, setRules]           = useState<CustomAnomalyRule[]>([])
  const [isLoading, setIsLoading]   = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [newRule, setNewRule]       = useState<CreateRulePayload>(DEFAULT_RULE)
  const [saving, setSaving]         = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const loadRules = useCallback(async () => {
    if (isDemoActive) { setRules(DEMO_RULES); setIsLoading(false); return }
    if (!isEnterprise) { setIsLoading(false); return }
    try {
      const data = await customAnomalyRulesService.getRules()
      setRules(data)
    } catch (err: any) {
      toast.error('Failed to load rules')
    } finally {
      setIsLoading(false)
    }
  }, [isDemoActive])

  useEffect(() => { loadRules() }, [loadRules])

  const handleCreate = async () => {
    if (!newRule.name.trim()) { toast.error('Rule name is required'); return }
    if (newRule.threshold <= 0) { toast.error('Threshold must be greater than 0'); return }
    setSaving(true)
    try {
      if (isDemoActive) {
        const mock: CustomAnomalyRule = {
          ...newRule, id: Date.now().toString(),
          organizationId: 'demo', enabled: true,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          timeWindow: newRule.timeWindow ?? '24h',
          severity: newRule.severity ?? 'warning',
        }
        setRules(prev => [mock, ...prev])
      } else {
        const created = await customAnomalyRulesService.createRule(newRule)
        setRules(prev => [created, ...prev])
      }
      toast.success('Rule created')
      setNewRule(DEFAULT_RULE)
      setShowForm(false)
    } catch (err: any) {
      toast.error('Failed to create rule')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (rule: CustomAnomalyRule) => {
    setTogglingId(rule.id)
    try {
      if (isDemoActive) {
        setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
      } else {
        const updated = await customAnomalyRulesService.toggleRule(rule.id, !rule.enabled)
        setRules(prev => prev.map(r => r.id === rule.id ? updated : r))
      }
      toast.success(rule.enabled ? 'Rule disabled' : 'Rule enabled')
    } catch (err: any) {
      toast.error('Failed to update rule')
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      if (!isDemoActive) await customAnomalyRulesService.deleteRule(id)
      setRules(prev => prev.filter(r => r.id !== id))
      toast.success('Rule deleted')
    } catch (err: any) {
      toast.error('Failed to delete rule')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Enterprise gate ──
  if (!isEnterprise && !isDemoActive) {
    return (
      <div className="max-w-[1320px] mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 min-h-screen">
        <div className="mb-8">
          <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700 mb-1.5">Security</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Custom Anomaly Rules</h1>
          <p className="text-gray-500 text-sm mt-1.5">Define custom detection thresholds and conditions for your infrastructure.</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl py-16 px-10 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-5 h-5 text-gray-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Enterprise Feature</h2>
          <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
            Custom anomaly rules are available on the Enterprise plan. Define your own thresholds, conditions, and alert logic.
          </p>
          <Link href="/settings/billing/upgrade" className="inline-block bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline">
            Upgrade to Enterprise
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[1320px] mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 min-h-screen bg-slate-50">

      {/* ── HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700 mb-1.5">Security</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Custom Anomaly Rules</h1>
          <p className="text-gray-500 text-sm mt-1.5">
            Define custom detection thresholds and alert conditions for your AWS infrastructure.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/anomalies" className="text-sm font-medium text-slate-600 hover:text-violet-700 no-underline px-4 py-2 border border-slate-200 rounded-lg bg-white">
            ← View Anomalies
          </Link>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-violet-700 hover:bg-violet-800 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            <Plus size={16} /> New Rule
          </button>
        </div>
      </div>

      {/* ── STATS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Rules',    value: rules.length,                              color: '#1e1b4b' },
          { label: 'Active Rules',   value: rules.filter(r => r.enabled).length,       color: '#059669' },
          { label: 'Critical Rules', value: rules.filter(r => r.severity === 'critical').length, color: '#DC2626' },
          { label: 'Warning Rules',  value: rules.filter(r => r.severity === 'warning').length,  color: '#D97706' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{label}</p>
            <p className="text-3xl font-bold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── CREATE RULE FORM ── */}
      {showForm && (
        <div className="bg-white border border-violet-200 rounded-xl p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-slate-900">Create New Rule</h2>
            <button onClick={() => { setShowForm(false); setNewRule(DEFAULT_RULE) }} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {/* Name */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Rule Name *</label>
              <input
                type="text"
                value={newRule.name}
                onChange={e => setNewRule(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. EC2 Cost Spike Alert"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>

            {/* Description */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Description (optional)</label>
              <input
                type="text"
                value={newRule.description ?? ''}
                onChange={e => setNewRule(p => ({ ...p, description: e.target.value }))}
                placeholder="What does this rule detect?"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>

            {/* Metric */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Metric</label>
              <select
                value={newRule.metric}
                onChange={e => setNewRule(p => ({ ...p, metric: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {METRIC_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>

            {/* Condition */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Condition</label>
              <select
                value={newRule.condition}
                onChange={e => setNewRule(p => ({ ...p, condition: e.target.value as any }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {CONDITION_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>

            {/* Threshold */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Threshold {newRule.condition.includes('percent') ? '(%)' : newRule.metric.includes('cost') ? '($)' : ''}
              </label>
              <input
                type="number"
                value={newRule.threshold}
                onChange={e => setNewRule(p => ({ ...p, threshold: Number(e.target.value) }))}
                min={0}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>

            {/* Time Window */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Time Window</label>
              <select
                value={newRule.timeWindow ?? '24h'}
                onChange={e => setNewRule(p => ({ ...p, timeWindow: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {TIME_WINDOW_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {/* Severity */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Severity</label>
              <select
                value={newRule.severity ?? 'warning'}
                onChange={e => setNewRule(p => ({ ...p, severity: e.target.value as any }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </div>
          </div>

          {/* Preview */}
          {newRule.name && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 mb-4">
              <p className="text-xs text-slate-500 mb-1">Rule preview</p>
              <p className="text-sm font-medium text-slate-800">
                Alert <span className="text-violet-700 font-semibold">{newRule.severity}</span> when{' '}
                <span className="text-slate-900 font-semibold">
                  {METRIC_OPTIONS.find(m => m.value === newRule.metric)?.label}
                </span>{' '}
                {CONDITION_OPTIONS.find(c => c.value === newRule.condition)?.label.toLowerCase()}{' '}
                <span className="text-slate-900 font-semibold">
                  {newRule.threshold}{newRule.condition.includes('percent') ? '%' : newRule.metric.includes('cost') ? ' USD' : ''}
                </span>{' '}
                over <span className="text-slate-900 font-semibold">{TIME_WINDOW_OPTIONS.find(t => t.value === newRule.timeWindow)?.label}</span>
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={() => { setShowForm(false); setNewRule(DEFAULT_RULE) }}
              className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-5 py-2 text-sm font-semibold text-white bg-violet-700 hover:bg-violet-800 rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating...' : 'Create Rule'}
            </button>
          </div>
        </div>
      )}

      {/* ── RULES LIST ── */}
      {isLoading ? (
        <div className="bg-white border border-gray-100 rounded-xl p-12 text-center">
          <p className="text-slate-400 text-sm">Loading rules...</p>
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-violet-50 flex items-center justify-center mx-auto mb-4">
            <SlidersHorizontal className="w-5 h-5 text-violet-600" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 mb-2">No custom rules yet</h3>
          <p className="text-sm text-slate-500 mb-5">Create your first rule to get alerted on custom thresholds.</p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 bg-violet-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold"
          >
            <Plus size={16} /> Create First Rule
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map(rule => {
            const sev = SEVERITY_CONFIG[rule.severity]
            return (
              <div key={rule.id} className="bg-white border border-gray-100 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
                {/* Left */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-slate-900">{rule.name}</span>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ color: sev.color, background: sev.bg, border: `1px solid ${sev.border}` }}
                    >
                      {sev.label}
                    </span>
                    {!rule.enabled && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">Disabled</span>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-xs text-slate-500 mb-1">{rule.description}</p>
                  )}
                  <p className="text-xs text-slate-400">{conditionLabel(rule)}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggle(rule)}
                    disabled={togglingId === rule.id}
                    className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-violet-700 px-3 py-1.5 border border-slate-200 rounded-lg hover:border-violet-300 transition-colors disabled:opacity-50"
                  >
                    {rule.enabled
                      ? <ToggleRight size={14} className="text-violet-600" />
                      : <ToggleLeft size={14} />
                    }
                    {rule.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id)}
                    disabled={deletingId === rule.id}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    title="Delete rule"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
