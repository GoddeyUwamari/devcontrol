import type { BenchmarkLevel } from '../types'

/**
 * What a DORA metric card or export row is drawn from: a tracked metric, a
 * metric the deployment records cannot support (tracked === false, with the
 * reason), or a demo-mode fixture.
 */
export interface DisplayMetric {
  tracked?: boolean
  value?: number | null
  unit?: string
  benchmark?: BenchmarkLevel | null
  isCustomBenchmark?: boolean
  description?: string
  reason?: string
}

export const isNotTracked = (metric: DisplayMetric) => metric.tracked === false

/**
 * CSV export rows. An untracked metric is exported as "Not tracked" with its
 * reason and no value; a tracked one with nothing to measure has an empty
 * value. There is no trend column: no trend is computed.
 */
export function doraCsvRows(
  metrics: Record<'deploymentFrequency' | 'leadTime' | 'changeFailureRate' | 'mttr', DisplayMetric>
): string[][] {
  const row = (label: string, metric: DisplayMetric) => isNotTracked(metric)
    ? [label, 'Not tracked', '', '', metric.reason ?? '']
    : [label, metric.value == null ? '' : metric.value.toFixed(2), metric.unit ?? '', metric.benchmark ?? '', metric.description ?? '']
  return [
    ['Metric', 'Value', 'Unit', 'Benchmark', 'Note'],
    row('Deployment Frequency', metrics.deploymentFrequency),
    row('Lead Time for Changes', metrics.leadTime),
    row('Change Failure Rate', metrics.changeFailureRate),
    row('Mean Time to Recovery', metrics.mttr),
  ]
}
