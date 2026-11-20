/**
 * Test fixtures in the shape of GET /api/metrics/dora (D4). Values are what the
 * API would send; the page must render them, never recompute them. Tests that
 * prove a value is read (not recomputed) override single fields so that the
 * fixture is deliberately inconsistent with its own counts.
 */
import type { DORABands, DORADailyEntry, DORAMetricsData } from '@/lib/services/dora-metrics.service'

export const API_BANDS: DORABands = {
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
}

/** Bands with labels no component could know: proves labels are read from the response. */
export const ODD_BANDS: DORABands = {
  ...API_BANDS,
  description: 'Test bands description from the API.',
  deploymentFrequency: {
    ...API_BANDS.deploymentFrequency,
    levels: API_BANDS.deploymentFrequency.levels.map((l) => ({ ...l, label: `API ${l.level} frequency label` })),
  },
  changeFailureRate: {
    ...API_BANDS.changeFailureRate,
    levels: API_BANDS.changeFailureRate.levels.map((l) => ({ ...l, label: `API ${l.level} failure label` })),
  },
}

/** 31 UTC days 2026-10-21 .. 2026-11-20 (a 30-day period), first and last partial. Sums: 116 succeeded, 0 failed. */
export function founderDaily(): DORADailyEntry[] {
  const out: DORADailyEntry[] = []
  const start = Date.UTC(2026, 9, 21)
  const zeroDays = new Set(['2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15'])
  let fives = 11
  for (let i = 0; i < 31; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    const partial = i === 0 || i === 30
    let s: number
    if (partial) s = 1
    else if (date === '2026-11-11') s = 7
    else if (zeroDays.has(date)) s = 0
    else if (fives > 0) { s = 5; fives-- }
    else s = 4
    out.push({ date, succeeded: s, failed: 0, total: s, partial })
  }
  return out
}

/** The founder's own account: 116 succeeded, none failed, 98 in the previous 30 days. */
export function founderData(): DORAMetricsData {
  return {
    deploymentFrequency: {
      tracked: true, value: 3.87, unit: 'per day', benchmark: 'elite', isCustomBenchmark: false,
      description: '116 successful deployments in 30 days',
    },
    leadTime: { tracked: false, reason: 'Deployment records hold no commit or change timestamp.' },
    changeFailureRate: {
      tracked: true, value: 0, unit: 'percentage', benchmark: 'elite', isCustomBenchmark: false,
      description: '0 failed out of 116 finished deployments',
    },
    mttr: { tracked: false, reason: 'No incident or service-restoration records are collected.' },
    deployments: { successful: 116, failed: 0, finished: 116 },
    period: { start: '2026-10-21', end: '2026-11-20', days: 30, startAt: '2026-10-21T15:00:00.000Z', endAt: '2026-11-20T15:00:00.000Z' },
    previousPeriod: {
      start: '2026-09-21', end: '2026-10-21', days: 30, startAt: '2026-09-21T15:00:00.000Z', endAt: '2026-10-21T15:00:00.000Z',
      deployments: { successful: 98, failed: 0, finished: 98 },
      deploymentsPerDay: 3.27,
      changeFailureRate: 0,
    },
    change: { finishedPercent: 18.4, deploymentsPerDayPercent: 18.4, changeFailureRatePercent: null },
    daily: founderDaily(),
    busiestDay: { date: '2026-11-11', total: 7, succeeded: 7, failed: 0, partial: false, tiedDays: 1 },
    filters: { environment: null, serviceId: null, teamId: null },
    bands: API_BANDS,
  }
}

/** Nothing finished in the period (and none before): frequency null, no grade, no change, zero-filled days. */
export function emptyData(): DORAMetricsData {
  const d = founderData()
  return {
    ...d,
    deploymentFrequency: { ...d.deploymentFrequency, value: null, benchmark: null, description: '0 successful deployments in 30 days' },
    changeFailureRate: { ...d.changeFailureRate, value: null, benchmark: null, description: 'No finished deployments in this period' },
    deployments: { successful: 0, failed: 0, finished: 0 },
    previousPeriod: { ...d.previousPeriod!, deployments: { successful: 0, failed: 0, finished: 0 }, deploymentsPerDay: null, changeFailureRate: null },
    change: { finishedPercent: null, deploymentsPerDayPercent: null, changeFailureRatePercent: null },
    daily: founderDaily().map((x) => ({ ...x, succeeded: 0, failed: 0, total: 0 })),
    busiestDay: null,
  }
}

/** A period with failures: 48 succeeded, 2 failed (4%), previous 39 + 1 (2.5%). */
export function mixedData(): DORAMetricsData {
  const d = founderData()
  const daily = founderDaily().map((x) => ({ ...x }))
  return {
    ...d,
    deploymentFrequency: { ...d.deploymentFrequency, value: 1.6, benchmark: 'elite' },
    changeFailureRate: { ...d.changeFailureRate, value: 4, benchmark: 'elite' },
    deployments: { successful: 48, failed: 2, finished: 50 },
    previousPeriod: { ...d.previousPeriod!, deployments: { successful: 39, failed: 1, finished: 40 }, deploymentsPerDay: 1.3, changeFailureRate: 2.5 },
    change: { finishedPercent: 25, deploymentsPerDayPercent: 23.1, changeFailureRatePercent: 60 },
    daily,
    busiestDay: { date: '2026-11-20', total: 6, succeeded: 5, failed: 1, partial: true, tiedDays: 3 },
  }
}

export const STATS_BASE = {
  window_days: 30, total: 116, success: 116, failed: 0, in_progress: 0, no_completion_recorded: 0, unknown: 0,
  change_failure_rate: 0, organization_has_deployments: true,
  last_deployment: { status: 'success', deployed_at: '2026-11-19T11:55:00.000Z' },
}

export const PIPELINE_ROW = {
  id: 'dep-1', serviceId: 'svc-1', serviceName: 'devcontrol', environment: 'production', awsRegion: 'us-east-1',
  status: 'success', costEstimate: null, deployedBy: 'founder', deployedAt: '2026-11-19T11:55:00.000Z',
  metadata: { source: 'github_actions', workflow_name: 'deploy-backend' },
  createdAt: '2026-11-19T11:55:00.000Z', updatedAt: '2026-11-19T11:55:00.000Z',
}
