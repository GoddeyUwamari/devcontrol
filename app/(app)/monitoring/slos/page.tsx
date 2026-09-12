'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePlan } from '@/lib/hooks/use-plan'
import sloService, {
  SloDefinition, SloWithEvaluation, CreateSloPayload, SloIndicator, SloResourceType,
  SLI_RESOURCE_TYPE, SLI_LABEL,
} from '@/lib/services/slo.service'
import { awsResourcesService, AWSResource } from '@/lib/services/aws-resources.service'
import { Plus, Trash2, Lock, Target, AlertTriangle, HelpCircle, PlugZap } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

// Kept in sync with backend/src/services/slo-evaluation.ts by construction — every
// choice below is validated server-side (slo.service.ts's validateCreatePayload)
// against the exact same canonical set, so this list can never offer something the
// backend would reject. GET /api/slos/options exists for the same canonical values if
// a future consumer needs them without importing this file.
const SLI_OPTIONS: SloIndicator[] = ['ec2_availability', 'alb_latency_avg', 'alb_error_rate', 'lambda_error_rate']
const WINDOW_OPTIONS: Array<{ value: '24h' | '7d'; label: string }> = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
]

const DEFAULT_FORM: CreateSloPayload = { name: '', resourceId: '', sli: 'ec2_availability', targetValue: 99.9, evaluationWindow: '7d' }

function targetUnitLabel(sli: SloIndicator): string {
  return sli === 'alb_latency_avg' ? 'ms (max average latency)' : '% (required success rate)'
}

function statusMeta(status: SloWithEvaluation['evaluation']['status']) {
  switch (status) {
    case 'healthy': return { label: 'Healthy', badge: 'bg-emerald-100 text-emerald-700', bg: 'bg-white', border: 'border-slate-200' }
    case 'breached': return { label: 'Breached', badge: 'bg-red-600 text-white', bg: 'bg-red-50', border: 'border-red-200' }
    case 'insufficient_data': return { label: 'Insufficient Data', badge: 'bg-slate-100 text-slate-600', bg: 'bg-white', border: 'border-slate-200' }
    case 'resource_not_found': return { label: 'Resource Not Found', badge: 'bg-amber-100 text-amber-800', bg: 'bg-amber-50', border: 'border-amber-200' }
    case 'aws_not_connected': return { label: 'AWS Not Connected', badge: 'bg-slate-100 text-slate-600', bg: 'bg-white', border: 'border-slate-200' }
  }
}

function formatObserved(evaluation: SloWithEvaluation['evaluation'], sli: SloIndicator): string {
  if (evaluation.observedValue === null) return '—'
  if (evaluation.unit === 'ms') return `${evaluation.observedValue.toFixed(0)}ms avg`
  // Percent-based SLIs are stored/evaluated as a success rate internally (see
  // slo-evaluation.ts) — error-rate SLIs are shown back to the user as the error rate
  // they actually named the SLO for, not the internal success-rate framing.
  const isErrorRateSli = sli === 'alb_error_rate' || sli === 'lambda_error_rate'
  if (isErrorRateSli) return `${(100 - evaluation.observedValue).toFixed(2)}% errors (${evaluation.observedValue.toFixed(2)}% success)`
  return `${evaluation.observedValue.toFixed(2)}%`
}

export default function SLODashboardPage() {
  const { isEnterprise } = usePlan()

  const [items, setItems] = useState<SloWithEvaluation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CreateSloPayload>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [resourceOptions, setResourceOptions] = useState<AWSResource[]>([])
  const [resourceOptionsLoading, setResourceOptionsLoading] = useState(false)

  const loadSlos = useCallback(async () => {
    if (!isEnterprise) { setIsLoading(false); return }
    setLoadError(null)
    try {
      const data = await sloService.evaluateAll()
      setItems(data)
    } catch {
      setLoadError('Failed to load SLOs. Please try again.')
      toast.error('Failed to load SLOs')
    } finally {
      setIsLoading(false)
    }
  }, [isEnterprise])

  useEffect(() => { loadSlos() }, [loadSlos])

  // Resource picker: derives its choices from the org's actual discovered inventory for
  // the selected SLI's resource type, rather than a free-text field prone to typos that
  // would just surface as "resource_not_found" later — the same class of honesty
  // problem this whole feature exists to fix.
  useEffect(() => {
    if (!isEnterprise) return
    const resourceType: SloResourceType = SLI_RESOURCE_TYPE[form.sli]
    setResourceOptionsLoading(true)
    setResourceOptions([])
    awsResourcesService.getAll({ resource_type: resourceType, limit: 100 })
      .then((result: any) => setResourceOptions(result?.resources ?? []))
      .catch(() => setResourceOptions([]))
      .finally(() => setResourceOptionsLoading(false))
  }, [form.sli, isEnterprise])

  const resetForm = () => { setForm(DEFAULT_FORM); setShowForm(false) }

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error('SLO name is required'); return }
    if (!form.resourceId) { toast.error('Select a resource'); return }
    if (!Number.isFinite(form.targetValue) || form.targetValue <= 0) { toast.error('Enter a valid target'); return }
    setSaving(true)
    try {
      await sloService.createSlo(form)
      toast.success('SLO created')
      resetForm()
      await loadSlos()
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to create SLO')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (slo: SloDefinition) => {
    try {
      await sloService.updateSlo(slo.id, { enabled: !slo.enabled })
      toast.success(slo.enabled ? 'SLO disabled' : 'SLO enabled')
      await loadSlos()
    } catch {
      toast.error('Failed to update SLO')
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await sloService.deleteSlo(id)
      toast.success('SLO deleted')
      await loadSlos()
    } catch {
      toast.error('Failed to delete SLO')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Enterprise gate — UX only. The real security boundary is requireEnterprise on
  // every /api/slos route (backend/src/routes/slo.routes.ts); this just avoids showing
  // the management UI to an org that could not use it anyway. ──
  if (!isEnterprise) {
    return (
      <div className="max-w-[1320px] mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 min-h-screen">
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-violet-700 mb-1.5">Observability</p>
          <h1 className="text-2xl font-bold text-gray-900">SLO Dashboard &amp; Management</h1>
          <p className="text-xs text-gray-500 font-medium mt-1.5">Define and track Service Level Objectives across your infrastructure.</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl py-16 px-10 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-5 h-5 text-gray-400" />
          </div>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Enterprise Feature</h2>
          <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
            SLO Dashboard &amp; Management is available on the Enterprise plan — define reliability targets for EC2, ALB, and Lambda and track them against real CloudWatch telemetry.
          </p>
          <Link href="/settings/billing/upgrade" className="inline-block bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline">
            Upgrade to Enterprise
          </Link>
        </div>
      </div>
    )
  }

  const healthyCount = items.filter((i) => i.evaluation.status === 'healthy').length
  const breachedCount = items.filter((i) => i.evaluation.status === 'breached').length
  const unknownCount = items.length - healthyCount - breachedCount

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <p className="text-xs font-bold text-violet-600 uppercase tracking-widest mb-1.5">Observability</p>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1.5">SLO Dashboard &amp; Management</h1>
          <p className="text-xs text-slate-500 font-medium leading-relaxed max-w-xl">
            Live evaluation against real CloudWatch telemetry — EC2 availability, ALB average latency, ALB and Lambda error rate, over a 24-hour or 7-day window. Averages, not percentiles; not application-level uptime.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-violet-700 hover:bg-violet-800 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shrink-0"
        >
          <Plus size={16} /> New SLO
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">SLOs Defined</p>
          <div className="text-2xl font-bold text-slate-900">{items.length}</div>
        </div>
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200">
          <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-3">Healthy</p>
          <div className="text-2xl font-bold text-emerald-600">{healthyCount}</div>
        </div>
        <div className={`rounded-xl p-4 sm:p-5 border ${breachedCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
          <p className="text-xs font-bold text-red-600 uppercase tracking-widest mb-3">Breached</p>
          <div className="text-2xl font-bold text-red-600">{breachedCount}</div>
        </div>
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Unknown / No Data</p>
          <div className="text-2xl font-bold text-slate-500">{unknownCount}</div>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white border border-violet-200 rounded-xl p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-slate-900">Create New SLO</h2>
            <button onClick={resetForm} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">SLO Name *</label>
              <input
                type="text" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Checkout API availability"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Service Level Indicator *</label>
              <select
                value={form.sli}
                onChange={(e) => setForm({ ...form, sli: e.target.value as SloIndicator, resourceId: '' })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
              >
                {SLI_OPTIONS.map((sli) => <option key={sli} value={sli}>{SLI_LABEL[sli]}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Resource * {resourceOptionsLoading && <span className="text-slate-400 font-normal">(loading…)</span>}
              </label>
              <select
                value={form.resourceId}
                onChange={(e) => setForm({ ...form, resourceId: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                disabled={resourceOptionsLoading}
              >
                <option value="">
                  {resourceOptionsLoading ? 'Loading resources…' : resourceOptions.length === 0 ? `No ${SLI_RESOURCE_TYPE[form.sli]} resources discovered` : 'Select a resource'}
                </option>
                {resourceOptions.map((r) => (
                  <option key={r.resource_id} value={r.resource_id}>{r.resource_name || r.resource_id}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Target ({targetUnitLabel(form.sli)}) *</label>
              <input
                type="number" step="0.001" value={form.targetValue}
                onChange={(e) => setForm({ ...form, targetValue: parseFloat(e.target.value) })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Evaluation Window *</label>
              <select
                value={form.evaluationWindow}
                onChange={(e) => setForm({ ...form, evaluationWindow: e.target.value as '24h' | '7d' })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
              >
                {WINDOW_OPTIONS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 mb-4">
            <HelpCircle size={13} className="text-slate-400 shrink-0" />
            <p className="text-xs text-slate-500">
              {form.sli === 'alb_latency_avg'
                ? 'Latency is an average over the window, never a percentile (no p95/p99 data is available). No error budget applies to a latency target.'
                : 'Target is the required success rate. Error budget = 1 − target, tracked against the observed failure rate over the window.'}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-500 border border-slate-200 bg-white">Cancel</button>
            <button onClick={handleCreate} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-violet-700 hover:bg-violet-800 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create SLO'}
            </button>
          </div>
        </div>
      )}

      {/* SLO list */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="px-5 sm:px-7 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-0.5">Service Level Objectives</p>
          <p className="text-xs text-slate-500">{items.length} SLOs · evaluated live against CloudWatch on each load</p>
        </div>

        {isLoading ? (
          <div className="p-10 sm:p-16 text-center text-sm text-slate-400">Loading…</div>
        ) : loadError ? (
          <div className="p-10 sm:p-16 text-center">
            <AlertTriangle size={20} className="text-red-400 mx-auto mb-3" />
            <p className="text-sm text-slate-600">{loadError}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 sm:p-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-4"><Target size={20} className="text-slate-300" /></div>
            <p className="text-sm font-semibold text-slate-900 mb-2">No SLOs configured</p>
            <p className="text-sm text-slate-500 leading-relaxed mb-7 max-w-sm mx-auto">Create an SLO to begin monitoring service reliability.</p>
            <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-6 py-3 rounded-lg text-sm font-semibold transition-colors">
              <Plus size={13} /> New SLO
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 divide-slate-100" style={{ gap: '1px', background: '#F1F5F9' }}>
            {items.map(({ definition, evaluation }) => {
              const meta = statusMeta(evaluation.status)
              const budget = evaluation.errorBudget
              return (
                <div key={definition.id} className={`p-5 sm:p-7 ${meta.bg}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{SLI_LABEL[definition.sli]}</p>
                      <p className="text-sm font-semibold text-slate-900">{definition.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{definition.resourceId}</p>
                    </div>
                    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full shrink-0 ml-2 ${meta.badge}`}>{meta.label}</span>
                  </div>

                  {evaluation.status === 'aws_not_connected' && (
                    <p className="text-xs text-slate-500 flex items-center gap-1.5 mb-4"><PlugZap size={12} /> Connect an AWS account to evaluate this SLO.</p>
                  )}
                  {evaluation.status === 'resource_not_found' && (
                    <p className="text-xs text-amber-700 mb-4">This resource is no longer in your discovered inventory.</p>
                  )}
                  {evaluation.status === 'insufficient_data' && (
                    <p className="text-xs text-slate-500 mb-4">CloudWatch has no data for this resource in the last {definition.evaluationWindow}.</p>
                  )}

                  {(evaluation.status === 'healthy' || evaluation.status === 'breached') && (
                    <>
                      <div className="flex items-baseline gap-2 mb-2">
                        <span className={`text-lg font-bold tracking-tight ${evaluation.status === 'breached' ? 'text-red-600' : 'text-slate-900'}`}>
                          {formatObserved(evaluation, definition.sli)}
                        </span>
                        <span className="text-xs text-slate-500">
                          target {definition.targetValue}{evaluation.unit === 'ms' ? 'ms' : '%'}
                        </span>
                      </div>
                      {budget.applicable && budget.consumedFraction !== null && (
                        <div className={`rounded-lg px-3.5 py-2.5 mb-4 ${evaluation.status === 'breached' ? 'bg-red-100' : 'bg-slate-50'}`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Error Budget</span>
                            <span className={`text-xs font-bold ${budget.consumedFraction > 1 ? 'text-red-600' : budget.consumedFraction > 0.5 ? 'text-amber-600' : 'text-slate-500'}`}>
                              {(budget.consumedFraction * 100).toFixed(1)}% used
                            </span>
                          </div>
                          <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{ width: `${Math.min(budget.consumedFraction * 100, 100)}%`, background: budget.consumedFraction > 1 ? '#DC2626' : budget.consumedFraction > 0.5 ? '#D97706' : '#059669' }}
                            />
                          </div>
                        </div>
                      )}
                      {!budget.applicable && (
                        <p className="text-xs text-slate-400 mb-4">No error budget for latency SLIs.</p>
                      )}
                    </>
                  )}

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <button onClick={() => handleToggle(definition)} className="text-xs font-semibold text-slate-500 hover:text-violet-700">
                      {definition.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => handleDelete(definition.id)}
                      disabled={deletingId === definition.id}
                      className="text-xs font-semibold text-red-500 hover:text-red-700 flex items-center gap-1 disabled:opacity-50"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
