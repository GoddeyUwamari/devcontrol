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
 * CSV export rows, named as on the Engineering Intelligence cards (D5-D11).
 * A metric not measured yet is exported as "Planned" with the API's reason and
 * no value; a tracked one with nothing to measure has an empty value. There is
 * no trend column: no trend is computed.
 */
export function doraCsvRows(
  metrics: Record<'deploymentFrequency' | 'leadTime' | 'changeFailureRate' | 'mttr', DisplayMetric>
): string[][] {
  const row = (label: string, metric: DisplayMetric) => isNotTracked(metric)
    ? [label, 'Planned', '', '', metric.reason ?? '']
    : [label, metric.value == null ? '' : metric.value.toFixed(2), metric.unit ?? '', metric.benchmark ?? '', metric.description ?? '']
  return [
    ['Metric', 'Value', 'Unit', 'Benchmark', 'Note'],
    row('Deployment frequency', metrics.deploymentFrequency),
    row('Merge-to-production time', metrics.leadTime),
    row('Change failure rate', metrics.changeFailureRate),
    row('Failed deployment recovery time', metrics.mttr),
  ]
}
