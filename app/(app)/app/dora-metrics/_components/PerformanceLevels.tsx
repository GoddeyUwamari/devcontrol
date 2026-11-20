'use client'

import { useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { DORABands, DORAMetricsData, TrackedDORAMetric } from '@/lib/services/dora-metrics.service'
import { bandLabel, COPY, type MetricKey } from '../_lib/dora-page'
import { LevelChip, PlannedChip } from './LevelChip'

function LevelRow({ name, metricKey, metric, data }: { name: string; metricKey: MetricKey; metric: TrackedDORAMetric; data: DORAMetricsData }) {
  const noData = data.deployments.finished === 0 || metric.value == null || metric.benchmark == null
  let detail: ReactNode
  if (noData) detail = <span className="text-meta text-ink-muted">{COPY.levelsNoData}</span>
  else if (metric.isCustomBenchmark) detail = <span className="text-meta text-ink-accent">{COPY.levelsCustom}</span>
  else {
    const label = bandLabel(data.bands?.[metricKey], metric.benchmark)
    detail = (
      <span className="flex flex-wrap items-center gap-1.5">
        <LevelChip level={metric.benchmark!} />
        {label && <span className="text-meta text-ink-muted">· {label}</span>}
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-1 py-2.5 border-b border-slate-100" data-testid={`dora-levels-${metricKey}`}>
      <span className="text-ui text-ink">{name}</span>
      {detail}
    </div>
  )
}

/** Every level of both measured metrics, exactly as the API serves the bands. */
export function BandsTable({ bands }: { bands: DORABands }) {
  const metrics: { key: MetricKey; name: string }[] = [
    { key: 'deploymentFrequency', name: COPY.frequencyName },
    { key: 'changeFailureRate', name: COPY.failureName },
  ]
  return (
    <div className="flex flex-col gap-4" data-testid="dora-bands-table">
      {metrics.map(({ key, name }) => (
        <div key={key}>
          <h3 className="text-ui font-semibold text-ink mb-1.5">{name}</h3>
          <ul className="flex flex-col">
            {bands[key].levels.map((band) => (
              <li key={band.level} className="flex flex-wrap items-center gap-2 py-1.5 border-b border-slate-100 last:border-0">
                <LevelChip level={band.level} />
                <span className="text-meta text-ink-body">{band.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function PerformanceLevels({ data }: { data: DORAMetricsData }) {
  const [open, setOpen] = useState(false)
  const bands = data.bands
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col min-w-0" data-testid="dora-performance-levels" aria-label={COPY.levelsTitle}>
      <h2 className="text-card-title text-ink mb-1">{COPY.levelsTitle}</h2>
      <p className="text-meta text-ink-muted mb-2">{COPY.levelsIntro}</p>
      <LevelRow name={COPY.frequencyName} metricKey="deploymentFrequency" metric={data.deploymentFrequency} data={data} />
      <LevelRow name={COPY.failureName} metricKey="changeFailureRate" metric={data.changeFailureRate} data={data} />
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 border-b border-slate-100">
        <span className="text-ui text-ink">{COPY.levelsPlannedRow}</span>
        <PlannedChip />
      </div>
      {bands && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="self-start mt-3 text-label text-ink-accent bg-transparent border-none p-0 cursor-pointer hover:underline min-h-11 sm:min-h-0"
        >
          {COPY.levelsSeeAll}
        </button>
      )}
      <p className="mt-auto pt-3 text-meta text-ink-muted" data-testid="dora-bands-description">
        {bands?.description ?? COPY.bandsFallbackDescription}
      </p>
      {bands && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Comparison bands</DialogTitle>
              <DialogDescription>{bands.description}</DialogDescription>
            </DialogHeader>
            <BandsTable bands={bands} />
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
