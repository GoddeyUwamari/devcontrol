/**
 * Demo mode and sales demo only (ruling D5-D10): one fixed response in the
 * shape of GET /api/metrics/dora, rendered by the same components as real data.
 * Literal values, no randomness. Internally consistent: the daily series sums
 * to the period counts, and the levels, change and busiest day are what the
 * API would return for these counts. The bands are a typed copy of what the API
 * serves, so the demo page reads them the same way; real mode never uses them.
 */
import type { DORAMetricsData } from '@/lib/services/dora-metrics.service'

export const DEMO_DORA_RESPONSE: DORAMetricsData = {
  deploymentFrequency: {
    tracked: true, value: 4.2, unit: 'per day', benchmark: 'elite', isCustomBenchmark: false,
    description: '126 successful deployments in 30 days',
  },
  leadTime: { tracked: false, reason: 'Deployment records hold no commit or change timestamp, so the time from change to deployment cannot be measured.' },
  changeFailureRate: {
    tracked: true, value: 1.56, unit: 'percentage', benchmark: 'elite', isCustomBenchmark: false,
    description: '2 failed out of 128 finished deployments',
  },
  mttr: { tracked: false, reason: 'No incident or service-restoration records are collected; a failed deployment is not evidence of an outage.' },
  deployments: { successful: 126, failed: 2, finished: 128 },
  period: { start: '2026-10-21', end: '2026-11-20', days: 30, startAt: '2026-10-21T12:00:00.000Z', endAt: '2026-11-20T12:00:00.000Z' },
  previousPeriod: {
    start: '2026-09-21', end: '2026-10-21', days: 30,
    startAt: '2026-09-21T12:00:00.000Z', endAt: '2026-10-21T12:00:00.000Z',
    deployments: { successful: 110, failed: 3, finished: 113 },
    deploymentsPerDay: 3.67,
    changeFailureRate: 2.65,
  },
  change: { finishedPercent: 13.3, deploymentsPerDayPercent: 14.5, changeFailureRatePercent: -41.1 },
  daily: [
    { date: '2026-10-21', succeeded: 2, failed: 0, total: 2, partial: true },
    { date: '2026-10-22', succeeded: 5, failed: 0, total: 5, partial: false },
    { date: '2026-10-23', succeeded: 4, failed: 0, total: 4, partial: false },
    { date: '2026-10-24', succeeded: 1, failed: 0, total: 1, partial: false },
    { date: '2026-10-25', succeeded: 1, failed: 0, total: 1, partial: false },
    { date: '2026-10-26', succeeded: 4, failed: 0, total: 4, partial: false },
    { date: '2026-10-27', succeeded: 6, failed: 0, total: 6, partial: false },
    { date: '2026-10-28', succeeded: 5, failed: 0, total: 5, partial: false },
    { date: '2026-10-29', succeeded: 6, failed: 0, total: 6, partial: false },
    { date: '2026-10-30', succeeded: 5, failed: 1, total: 6, partial: false },
    { date: '2026-10-31', succeeded: 1, failed: 0, total: 1, partial: false },
    { date: '2026-11-01', succeeded: 2, failed: 0, total: 2, partial: false },
    { date: '2026-11-02', succeeded: 5, failed: 0, total: 5, partial: false },
    { date: '2026-11-03', succeeded: 6, failed: 0, total: 6, partial: false },
    { date: '2026-11-04', succeeded: 5, failed: 0, total: 5, partial: false },
    { date: '2026-11-05', succeeded: 6, failed: 0, total: 6, partial: false },
    { date: '2026-11-06', succeeded: 5, failed: 0, total: 5, partial: false },
    { date: '2026-11-07', succeeded: 1, failed: 0, total: 1, partial: false },
    { date: '2026-11-08', succeeded: 2, failed: 0, total: 2, partial: false },
    { date: '2026-11-09', succeeded: 5, failed: 0, total: 5, partial: false },
    { date: '2026-11-10', succeeded: 6, failed: 0, total: 6, partial: false },
    { date: '2026-11-11', succeeded: 5, failed: 0, total: 5, partial: false },
    { date: '2026-11-12', succeeded: 6, failed: 1, total: 7, partial: false },
    { date: '2026-11-13', succeeded: 5, failed: 0, total: 5, partial: false },
    { date: '2026-11-14', succeeded: 1, failed: 0, total: 1, partial: false },
    { date: '2026-11-15', succeeded: 2, failed: 0, total: 2, partial: false },
    { date: '2026-11-16', succeeded: 5, failed: 0, total: 5, partial: false },
    { date: '2026-11-17', succeeded: 6, failed: 0, total: 6, partial: false },
    { date: '2026-11-18', succeeded: 5, failed: 0, total: 5, partial: false },
    { date: '2026-11-19', succeeded: 6, failed: 0, total: 6, partial: false },
    { date: '2026-11-20', succeeded: 2, failed: 0, total: 2, partial: true },
  ],
  busiestDay: { date: '2026-11-12', total: 7, succeeded: 6, failed: 1, partial: false, tiedDays: 1 },
  filters: { environment: null, serviceId: null, teamId: null },
  bands: {
    version: 1,
    description: 'DevControl comparison bands are informed by the DORA 2023 performance clusters. These are directional benchmarks, not official DORA cutoffs.',
    deploymentFrequency: {
      unit: 'per_day',
      direction: 'higher_is_better',
      levels: [
        { level: 'elite', lower: { value: 1, inclusive: false }, upper: null, label: 'More than once a day' },
        { level: 'high', lower: { value: 0.14, inclusive: true }, upper: { value: 1, inclusive: true }, label: 'At least once a week (0.14 per day), up to once a day' },
        { level: 'medium', lower: { value: 0.03, inclusive: true }, upper: { value: 0.14, inclusive: false }, label: 'At least once a month (0.03 per day), less than once a week' },
        { level: 'low', lower: null, upper: { value: 0.03, inclusive: false }, label: 'Less than once a month (below 0.03 per day)' },
      ],
    },
    changeFailureRate: {
      unit: 'percentage',
      direction: 'lower_is_better',
      levels: [
        { level: 'elite', lower: null, upper: { value: 5, inclusive: true }, label: '5% or less' },
        { level: 'high', lower: { value: 5, inclusive: false }, upper: { value: 10, inclusive: true }, label: 'More than 5%, up to 10%' },
        { level: 'medium', lower: { value: 10, inclusive: false }, upper: { value: 15, inclusive: true }, label: 'More than 10%, up to 15%' },
        { level: 'low', lower: { value: 15, inclusive: false }, upper: null, label: 'More than 15%' },
      ],
    },
  },
}
