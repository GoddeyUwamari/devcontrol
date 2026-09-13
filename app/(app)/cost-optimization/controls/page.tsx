'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePlan } from '@/lib/hooks/use-plan'
import {
  costRecommendationsService,
  EffectiveOptimizationRuleConfig,
} from '@/lib/services/cost-recommendations.service'
import { Lock, SlidersHorizontal, RotateCcw, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

// Enterprise Workstream 3B: product/UI copy for the two rules the backend
// registry (backend/src/config/optimization-rules.ts) allows an organization
// to tune. Bounds/default/unit/type always come from the configuration API
// below, never duplicated here -- this map is display text only, since the
// API has no room for a human explanation of what a threshold means.
const RULE_COPY: Record<string, { ruleName: string; parameterLabel: string; description: string }> = {
  ec2_idle: {
    ruleName: 'Idle EC2 instances',
    parameterLabel: 'CPU utilization threshold',
    description:
      'An EC2 instance is considered idle when its average CPU utilization over the 7-day evaluation window is below this threshold.',
  },
  lambda_low_usage: {
    ruleName: 'Low-usage Lambda functions',
    parameterLabel: 'Maximum invocations',
    description:
      'A Lambda function is considered low usage when it has at most this many invocations over the 30-day evaluation window.',
  },
}

function keyFor(c: { ruleId: string; parameterId: string }): string {
  return `${c.ruleId}:${c.parameterId}`
}

// Client-side check only, for immediate feedback -- the PUT endpoint
// (OptimizationRuleConfigService) is the authoritative validator and is
// never bypassed or duplicated beyond this UX convenience.
function validate(config: EffectiveOptimizationRuleConfig, raw: string): string | null {
  if (raw.trim() === '') return 'A value is required'
  const n = Number(raw)
  if (!Number.isFinite(n)) return 'Enter a valid number'
  if (config.type === 'integer' && !Number.isInteger(n)) return 'Must be a whole number'
  if (n < config.min || n > config.max) return `Must be between ${config.min} and ${config.max}`
  return null
}

export default function OptimizationControlsPage() {
  const { isEnterprise } = usePlan()

  const [configs, setConfigs] = useState<EffectiveOptimizationRuleConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [resettingKey, setResettingKey] = useState<string | null>(null)

  const loadConfig = useCallback(async () => {
    if (!isEnterprise) { setIsLoading(false); return }
    setIsLoading(true)
    setLoadError(null)
    try {
      const data = await costRecommendationsService.getOptimizationRuleConfiguration()
      setConfigs(data)
      setDrafts(Object.fromEntries(data.map((c) => [keyFor(c), String(c.value)])))
    } catch {
      setLoadError('Failed to load optimization controls. Please try again.')
      toast.error('Failed to load optimization controls')
    } finally {
      setIsLoading(false)
    }
  }, [isEnterprise])

  useEffect(() => { loadConfig() }, [loadConfig])

  const handleDraftChange = (config: EffectiveOptimizationRuleConfig, raw: string) => {
    const key = keyFor(config)
    setDrafts((prev) => ({ ...prev, [key]: raw }))
    setFieldErrors((prev) => ({ ...prev, [key]: validate(config, raw) }))
  }

  const handleSave = async (config: EffectiveOptimizationRuleConfig) => {
    const key = keyFor(config)
    const raw = drafts[key] ?? ''
    const error = validate(config, raw)
    if (error) { setFieldErrors((prev) => ({ ...prev, [key]: error })); return }

    setSavingKey(key)
    try {
      const result = await costRecommendationsService.updateOptimizationRuleConfiguration(
        config.ruleId, config.parameterId, Number(raw)
      )
      setConfigs((prev) => prev.map((c) => (keyFor(c) === key ? { ...c, value: result.value, source: result.source } : c)))
      setDrafts((prev) => ({ ...prev, [key]: String(result.value) }))
      setFieldErrors((prev) => ({ ...prev, [key]: null }))
      toast.success('Threshold updated')
    } catch (err: any) {
      const message = err?.response?.data?.error || 'Failed to update threshold'
      setFieldErrors((prev) => ({ ...prev, [key]: message }))
      toast.error(message)
    } finally {
      setSavingKey(null)
    }
  }

  const handleReset = async (config: EffectiveOptimizationRuleConfig) => {
    const key = keyFor(config)
    setResettingKey(key)
    try {
      await costRecommendationsService.resetOptimizationRuleConfiguration(config.ruleId, config.parameterId)
      setConfigs((prev) => prev.map((c) => (keyFor(c) === key ? { ...c, value: c.default, source: 'default' } : c)))
      setDrafts((prev) => ({ ...prev, [key]: String(config.default) }))
      setFieldErrors((prev) => ({ ...prev, [key]: null }))
      toast.success('Reset to default')
    } catch {
      toast.error('Failed to reset threshold')
    } finally {
      setResettingKey(null)
    }
  }

  // ── Enterprise gate — UX only. The real security boundary is
  // requireEnterprise on every /optimization-rules/configuration route
  // (backend/src/routes/cost-recommendations.routes.ts); this just avoids
  // showing the tuning UI to an org that could not use it anyway. The
  // read-only optimization-rules catalog itself remains available to every
  // tier -- only tuning is gated. ──
  if (!isEnterprise) {
    return (
      <div className="max-w-[1320px] mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 min-h-screen">
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-violet-700 mb-1.5">Cost Optimization</p>
          <h1 className="text-2xl font-bold text-gray-900">Optimization Controls</h1>
          <p className="text-xs text-gray-500 font-medium mt-1.5">
            Tune how DevControl identifies selected cost optimization opportunities for your organization.
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl py-16 px-10 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-5 h-5 text-gray-400" />
          </div>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Enterprise Feature</h2>
          <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
            Optimization Controls are available on the Enterprise plan — tune the CPU utilization threshold for idle
            EC2 detection and the invocation threshold for low-usage Lambda detection.
          </p>
          <Link href="/settings/billing/upgrade" className="inline-block bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline">
            Upgrade to Enterprise
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">
      <div className="mb-8">
        <p className="text-xs font-bold text-violet-600 uppercase tracking-widest mb-1.5">Cost Optimization</p>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1.5">Optimization Controls</h1>
        <p className="text-xs text-slate-500 font-medium leading-relaxed max-w-xl">
          Tune how DevControl identifies selected cost optimization opportunities for your organization. Only the
          two thresholds below are configurable — every other check uses its built-in default.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="px-5 sm:px-7 py-4 border-b border-slate-100 flex items-start gap-2.5">
          <SlidersHorizontal size={15} className="text-slate-400 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-500 leading-relaxed">
            Changing a threshold affects which resources are flagged going forward. It does not guarantee savings
            and does not change recommendations already identified.
          </p>
        </div>

        {isLoading ? (
          <div className="p-10 sm:p-16 text-center text-sm text-slate-400">Loading…</div>
        ) : loadError ? (
          <div className="p-10 sm:p-16 text-center">
            <AlertTriangle size={20} className="text-red-400 mx-auto mb-3" />
            <p className="text-sm text-slate-600 mb-4">{loadError}</p>
            <button
              onClick={loadConfig}
              className="bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold px-5 py-2.5 rounded-lg border-none cursor-pointer transition-colors"
            >
              Try again
            </button>
          </div>
        ) : configs.length === 0 ? (
          <div className="p-10 sm:p-16 text-center text-sm text-slate-500">
            No configurable optimization rules are available right now.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {configs.map((config) => {
              const key = keyFor(config)
              const copy = RULE_COPY[config.ruleId] ?? {
                ruleName: config.ruleId,
                parameterLabel: config.parameterId,
                description: '',
              }
              const draft = drafts[key] ?? String(config.value)
              const fieldError = fieldErrors[key]
              const isOverride = config.source === 'organization_override'
              const isDirty = draft !== String(config.value)
              const step = config.type === 'integer' ? 1 : 0.1

              return (
                <div key={key} className="p-5 sm:p-7">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{copy.ruleName}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{copy.parameterLabel}</p>
                    </div>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full shrink-0 ${
                        isOverride ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {isOverride ? 'Organization override' : 'Default'}
                    </span>
                  </div>

                  {copy.description && (
                    <p className="text-xs text-slate-500 leading-relaxed mb-4 max-w-2xl">{copy.description}</p>
                  )}

                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5" htmlFor={`input-${key}`}>
                        {copy.parameterLabel} ({config.unit})
                      </label>
                      <input
                        id={`input-${key}`}
                        type="number"
                        step={step}
                        min={config.min}
                        max={config.max}
                        value={draft}
                        onChange={(e) => handleDraftChange(config, e.target.value)}
                        className="w-40 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                      />
                      <p className="text-[11px] text-slate-400 mt-1">
                        Default {config.default} · Range {config.min}–{config.max}
                      </p>
                    </div>

                    <button
                      onClick={() => handleSave(config)}
                      disabled={savingKey === key || !isDirty || !!fieldError}
                      className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-violet-700 hover:bg-violet-800 disabled:opacity-50"
                    >
                      {savingKey === key ? 'Saving…' : 'Save'}
                    </button>

                    <button
                      onClick={() => handleReset(config)}
                      disabled={resettingKey === key}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-slate-500 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                    >
                      <RotateCcw size={13} /> {resettingKey === key ? 'Resetting…' : 'Reset to default'}
                    </button>
                  </div>

                  {fieldError && <p className="text-xs text-red-600 mt-2">{fieldError}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
