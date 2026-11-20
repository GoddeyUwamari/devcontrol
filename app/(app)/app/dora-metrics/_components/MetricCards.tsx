import Link from 'next/link'
import type { ReactNode } from 'react'
import type { DORAMetricsData, TrackedDORAMetric } from '@/lib/services/dora-metrics.service'
import {
  COPY,
  type MetricKey,
  failureChangeLine,
  failureFactLine,
  formatMetricValue,
  formatTarget,
  frequencyChangeLine,
  frequencyFactLine,
  LEVEL_NAME,
} from '../_lib/dora-page'
import { LevelChip, PlannedChip, TargetChip } from './LevelChip'

const CARD = 'bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col min-w-0'

export type TargetValues = Partial<Record<MetricKey, number>>

interface MetricCardProps {
  metricKey: MetricKey
  name: string
  metric: TrackedDORAMetric
  data: DORAMetricsData
  target: number | undefined
  testId: string
}

function MetricCard({ metricKey, name, metric, data, target, testId }: MetricCardProps) {
  const noData = data.deployments.finished === 0 || metric.value == null
  const level = noData ? null : metric.benchmark
  const bands = data.bands?.[metricKey]
  const change = noData ? null : metricKey === 'deploymentFrequency' ? frequencyChangeLine(data) : failureChangeLine(data)
  const fact = metricKey === 'deploymentFrequency' ? frequencyFactLine(data) : failureFactLine(data)
  const noDataText = metricKey === 'deploymentFrequency' ? COPY.frequencyNoData : COPY.failureNoData
  const custom = !noData && metric.isCustomBenchmark && level != null

  return (
    <section className={`${CARD} col-span-2 sm:col-span-1`} data-testid={testId} aria-label={name}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <h2 className="text-label text-ink-muted uppercase tracking-[0.04em]">{name}</h2>
        {level && (custom
          ? <TargetChip meets={level === 'elite'} testId={`${testId}-target-chip`} />
          : <LevelChip level={level} testId={`${testId}-chip`} />)}
      </div>
      <div className="text-kpi tabular-nums text-ink leading-none mb-2" data-testid={`${testId}-value`}>
        {noData || metric.value == null
          ? '—'
          : formatMetricValue(metricKey, metric.value, { benchmark: metric.benchmark, isCustomBenchmark: metric.isCustomBenchmark }, bands, custom ? target : undefined)}
      </div>
      {custom && level && (
        <p className="text-meta text-ink-accent mb-1" data-testid={`${testId}-target`}>
          {target !== undefined ? `Your target ${formatTarget(metricKey, target)} · ` : 'Graded against your target · '}Level: {LEVEL_NAME[level]}
        </p>
      )}
      {change && <p className="text-meta text-ink-body mb-1" data-testid={`${testId}-change`}>{change}</p>}
      <p className="text-meta text-ink-muted" data-testid={`${testId}-fact`}>{noData ? noDataText : fact}</p>
      <Link href={COPY.deploymentsHref} className="mt-auto pt-3 text-label text-ink-accent no-underline hover:underline self-start inline-flex items-center min-h-11 sm:min-h-0">
        {COPY.viewDeployments}
      </Link>
    </section>
  )
}

function PlannedCard({ name, testId, children }: { name: string; testId: string; children: ReactNode }) {
  return (
    <section className={`${CARD} col-span-1`} data-testid={testId} aria-label={name}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <h2 className="text-label text-ink-muted uppercase tracking-[0.04em]">{name}</h2>
        <PlannedChip />
      </div>
      {children}
    </section>
  )
}

/** The four metric cards. The two Planned cards render only while the API reports those metrics as not tracked. */
export function MetricCards({ data, targets }: { data: DORAMetricsData; targets: TargetValues }) {
  const noData = data.deployments.finished === 0
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="dora-metric-cards">
      <MetricCard
        metricKey="deploymentFrequency" name={COPY.frequencyName} metric={data.deploymentFrequency}
        data={data} target={targets.deploymentFrequency} testId="dora-card-deployment-frequency"
      />
      <MetricCard
        metricKey="changeFailureRate" name={COPY.failureName} metric={data.changeFailureRate}
        data={data} target={targets.changeFailureRate} testId="dora-card-change-failure-rate"
      />
      {data.leadTime.tracked === false && (
        <PlannedCard name={COPY.mergeName} testId="dora-card-merge-to-production-time">
          <p className="text-meta text-ink-muted">
            {COPY.mergeText1}{noData ? '' : ` ${COPY.mergeText2}`}
          </p>
        </PlannedCard>
      )}
      {data.mttr.tracked === false && (
        <PlannedCard name={COPY.recoveryName} testId="dora-card-failed-deployment-recovery-time">
          {!noData && data.deployments.failed === 0 && (
            <p className="text-meta text-ink-body mb-1.5">{COPY.recoveryNoFailures}</p>
          )}
          <p className="text-meta text-ink-muted">{COPY.recoveryText}</p>
        </PlannedCard>
      )}
    </div>
  )
}
