'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PLAN_DISPLAY_NAME } from '@/lib/plan/plan-names'
import type { DORABands } from '@/lib/services/dora-metrics.service'
import { bandLabel, COPY, formatTarget, type MetricKey } from '../_lib/dora-page'

/** A row of GET /api/dora/benchmarks. */
export interface CustomBenchmark { metric_name: string; target_value: number; target_unit: string; performance_label: string }

/** The two measured metrics a target can grade (ruling D5-D9). */
const EDITABLE: { metricName: string; key: MetricKey; name: string; unitLabel: string; placeholder: string; hint: string }[] = [
  { metricName: 'deployment_frequency', key: 'deploymentFrequency', name: COPY.frequencyName, unitLabel: 'deployments/day', placeholder: 'e.g. 2', hint: 'Meets your target at or above this many successful deploys per day.' },
  { metricName: 'change_failure_rate', key: 'changeFailureRate', name: COPY.failureName, unitLabel: '%', placeholder: 'e.g. 5', hint: 'Meets your target at or below this failure rate.' },
]
/** Targets for metrics that are not measured yet: shown read-only, with Reset, if one is stored. */
// No label input (founder ruling): the stored performance_label is sent back unchanged, because the API's
// upsert overwrites it; a new target gets the API's own default, 'Elite'.
const NOT_MEASURED: { metricName: string; name: string }[] = [
  { metricName: 'lead_time', name: COPY.mergeName },
  { metricName: 'recovery_time', name: COPY.recoveryName },
]

const BUTTON = 'px-3.5 py-1.5 min-h-11 sm:min-h-0 rounded-lg text-label cursor-pointer transition-colors'
const SECONDARY = `${BUTTON} bg-white text-ink-muted border border-slate-200 hover:bg-slate-50`

const CARD = 'bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col min-w-0'

export function LockedTargets() {
  return (
    <section className={CARD} data-testid="dora-targets-locked" aria-label={COPY.targetsTitle}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-card-title text-ink">{COPY.targetsTitle}</h2>
        <span className="text-label text-ink-accent bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 whitespace-nowrap">{PLAN_DISPLAY_NAME.enterprise}</span>
      </div>
      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
        <Lock size={16} className="text-ink-muted" aria-hidden="true" />
      </div>
      <p className="text-ui font-semibold text-ink mb-1">{COPY.lockedTitle}</p>
      <p className="text-meta text-ink-muted mb-4">{COPY.lockedBody}</p>
      <Link href="/settings/billing" className="mt-auto self-start text-label text-ink-accent no-underline hover:underline inline-flex items-center min-h-11 sm:min-h-0">
        Upgrade to {PLAN_DISPLAY_NAME.enterprise} →
      </Link>
    </section>
  )
}

interface TargetsProps {
  benchmarks: CustomBenchmark[]
  bands: DORABands | undefined
  /** Demo data: no editing. */
  readOnly: boolean
  saveError: string | null
  onSave: (metricName: string, value: string, label: string) => Promise<boolean>
  onReset: (metricName: string) => Promise<void>
  onClearError: () => void
}

export function YourTargets({ benchmarks, bands, readOnly, saveError, onSave, onReset, onClearError }: TargetsProps) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const byName: Record<string, CustomBenchmark> = Object.fromEntries(benchmarks.map((b) => [b.metric_name, b]))

  return (
    <section className={CARD} data-testid="dora-targets" aria-label={COPY.targetsTitle}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-card-title text-ink">{COPY.targetsTitle}</h2>
        <span className="text-label text-ink-accent bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 whitespace-nowrap">{PLAN_DISPLAY_NAME.enterprise}</span>
      </div>
      <p className="text-meta text-ink-muted mb-2">{COPY.targetsIntro}</p>
      {EDITABLE.map((m) => {
        const custom = byName[m.metricName]
        return (
          <div key={m.metricName} className="flex flex-col gap-0.5 py-2.5 border-b border-slate-100" data-testid={`dora-target-${m.metricName}`}>
            <span className="text-ui text-ink">{m.name}</span>
            <span className={`text-meta ${custom ? 'text-ink-accent' : 'text-ink-muted'}`}>
              {custom ? `Target ${formatTarget(m.key, Number(custom.target_value))}` : COPY.targetsNone}
            </span>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => { setOpen(true); setEditing(null); onClearError() }}
        disabled={readOnly}
        className="self-start mt-3 text-label text-ink-accent bg-transparent border-none p-0 cursor-pointer hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:text-ink-muted min-h-11 sm:min-h-0"
      >
        {COPY.targetsSet}
      </button>
      {readOnly && <p className="text-meta text-ink-muted mt-1">Targets can&apos;t be set on demo data.</p>}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-testid="dora-targets-dialog">
          <DialogHeader>
            <DialogTitle>{COPY.targetsTitle}</DialogTitle>
            <DialogDescription>{COPY.targetsIntro}</DialogDescription>
          </DialogHeader>
          {saveError && <p className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-meta text-ink-danger">{saveError}</p>}
          {EDITABLE.map((m) => {
            const custom = byName[m.metricName]
            const isEditing = editing === m.metricName
            const elite = bandLabel(bands?.[m.key], 'elite')
            return (
              <div key={m.metricName} className="flex flex-col gap-2 py-3 border-b border-slate-100" data-testid={`dora-target-edit-${m.metricName}`}>
                <div>
                  <p className="text-ui font-semibold text-ink">{m.name}</p>
                  {custom ? (
                    <p className="text-meta text-ink-accent">Your target {formatTarget(m.key, Number(custom.target_value))}</p>
                  ) : (
                    <p className="text-meta text-ink-muted" data-testid={`dora-target-default-${m.metricName}`}>
                      Default: comparison band{elite ? ` · Elite: ${elite}` : ''}
                    </p>
                  )}
                  {!isEditing && <p className="text-meta text-ink-muted">{m.hint}</p>}
                </div>
                {isEditing ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-meta text-ink-muted">
                      <span className="sr-only">{m.name} target</span>
                      <input type="number" min="0" step="any" value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder={m.placeholder} className="w-24 px-2.5 py-1.5 min-h-11 sm:min-h-0 border border-slate-200 rounded-lg text-ui text-ink outline-none focus:border-violet-500" />
                      {m.unitLabel}
                    </label>
                    <button type="button" onClick={async () => { if (await onSave(m.metricName, editValue, custom?.performance_label || 'Elite')) setEditing(null) }} className={`${BUTTON} bg-violet-600 hover:bg-violet-700 text-white border-none`}>Save</button>
                    <button type="button" onClick={() => { setEditing(null); onClearError() }} className={SECONDARY}>Cancel</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { setEditing(m.metricName); setEditValue(custom ? String(custom.target_value) : ''); onClearError() }}
                      className={SECONDARY}
                    >
                      {custom ? 'Edit' : 'Set Custom'}
                    </button>
                    {custom && (
                      <button type="button" onClick={() => onReset(m.metricName)} className={`${BUTTON} bg-white text-ink-danger border border-red-200 hover:bg-red-50`}>Reset to Default</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {NOT_MEASURED.filter((m) => byName[m.metricName]).map((m) => (
            <div key={m.metricName} className="flex flex-col gap-2 py-3 border-b border-slate-100" data-testid={`dora-target-unused-${m.metricName}`}>
              <p className="text-ui font-semibold text-ink">{m.name}</p>
              <p className="text-meta text-ink-muted">Stored target {byName[m.metricName].target_value} {byName[m.metricName].target_unit}. Not used until this metric is measured.</p>
              <button type="button" onClick={() => onReset(m.metricName)} className={`${BUTTON} self-start bg-white text-ink-danger border border-red-200 hover:bg-red-50`}>Reset to Default</button>
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </section>
  )
}
