/**
 * Demo mode only (founder ruling Q14): illustrative data that fills the
 * redesigned layout the same way real data does. Never shown for a real
 * account, never sourced from any backend service. Figures are internally
 * consistent (month-to-date = the April days below, savings = the listed
 * findings). Resource names and the address use reserved/documentation forms.
 */
import type { CostRecommendation, RecommendationStats } from '@/lib/types'
import type { CostTrendPointView } from './cost-intelligence'

const DEMO_SERVICES: { service: string; share: number; color: string }[] = [
  { service: 'EC2', share: 0.48, color: '#2a78d6' },
  { service: 'RDS', share: 0.2, color: '#1baf7a' },
  { service: 'S3', share: 0.11, color: '#eda100' },
  { service: 'EC2 (Other)', share: 0.08, color: '#eb6834' },
  { service: 'Lambda', share: 0.05, color: '#4a3aa7' },
  { service: 'VPC', share: 0.04, color: '#008300' },
  { service: 'Other', share: 0.04, color: '#94A3B8' },
]

/** The demo's last day (a fixed date: demo data never reads the clock). */
const DEMO_LAST_DAY = Date.UTC(2026, 3, 25)
const DAY_MS = 24 * 60 * 60 * 1000

/** 91 daily points ending Apr 25, the last one still updating, like a real 90d response. */
export const DEMO_TREND_POINTS: CostTrendPointView[] = Array.from({ length: 91 }, (_, i) => {
  const date = new Date(DEMO_LAST_DAY - (90 - i) * DAY_MS).toISOString().slice(0, 10)
  const total = Math.round((190 + 18 * Math.sin(i / 4) + (i % 7 === 3 ? 22 : 0)) * 100) / 100
  const byServiceDisplay = DEMO_SERVICES.map(({ service, share, color }) => ({ service, amount: Math.round(total * share * 100) / 100, color }))
  const sum = byServiceDisplay.reduce((s, p) => s + p.amount, 0)
  const cents = (v: number) => Math.round(v * 100) / 100
  return {
    date,
    compute: cents(total * 0.61),
    storage: cents(total * 0.19),
    database: cents(total * 0.2),
    network: 0,
    other: 0,
    total: cents(sum),
    lineItems: DEMO_SERVICES.length,
    reportState: i === 90 ? 'updating' : 'final',
    byServiceDisplay,
  }
})

/** Month-to-date: Apr 1–25 of the points above. */
export const DEMO_MTD_SPEND = Math.round(DEMO_TREND_POINTS.filter((p) => p.date >= '2026-04-01').reduce((s, p) => s + p.total, 0) * 100) / 100
export const DEMO_GROWTH_PERCENT = 8.2

const demoRec = (id: string, resourceType: string, resourceName: string, issue: string, potentialSavings: number, severity: CostRecommendation['severity'], metadata: Record<string, unknown>): CostRecommendation => ({
  id, resourceId: id, resourceName, resourceType, issue, potentialSavings, severity, status: 'ACTIVE', metadata, createdAt: '2026-04-25T06:00:00.000Z', updatedAt: '2026-04-25T06:00:00.000Z',
})

export const DEMO_RECOMMENDATIONS: CostRecommendation[] = [
  demoRec('demo-1', 'RDS', 'demo-reporting-db', 'Idle RDS Instance', 445, 'HIGH', {
    savings_basis: 'estimated: demo', rule: { window: { days: 30 } }, rds_idle: { worst: { cpu_peak_percent: 1.4 } },
  }),
  demoRec('demo-2', 'EC2', 'demo-batch-worker', 'Idle Instance', 362, 'MEDIUM', {
    savings_basis: 'estimated: demo', rule: { window: { days: 30 } }, low_activity: { worst: { cpu_peak_percent: 2.3, network_bytes_max: 1_850_000 } },
  }),
  demoRec('demo-3', 'S3', 'demo-logs-archive', 'S3 Lifecycle Optimization', 210, 'MEDIUM', {
    savings_basis: 'ceiling: demo', lifecycle_state: 'no_lifecycle_configuration', standard_storage_gb: 9120,
  }),
  demoRec('demo-4', 'EBS', 'demo-scratch-volume', 'Unattached EBS Volume', 48, 'LOW', {
    savings_basis: 'estimated: demo', size_gb: 600, volume_type: 'gp3',
  }),
  demoRec('demo-5', 'EC2', '203.0.113.10', 'Unused Elastic IP', 3.6, 'LOW', { savings_basis: 'estimated: demo' }),
]

const estimates = DEMO_RECOMMENDATIONS.filter((r) => String(r.metadata?.savings_basis).startsWith('estimated:'))
const ceilings = DEMO_RECOMMENDATIONS.filter((r) => String(r.metadata?.savings_basis).startsWith('ceiling:'))

export const DEMO_STATS: RecommendationStats = {
  totalRecommendations: DEMO_RECOMMENDATIONS.length,
  activeRecommendations: DEMO_RECOMMENDATIONS.length,
  totalPotentialSavings: estimates.reduce((s, r) => s + r.potentialSavings, 0),
  potentialSavingsByResourceType: {},
  potentialSavingsCeiling: ceilings.reduce((s, r) => s + r.potentialSavings, 0),
  potentialSavingsCeilingByResourceType: Object.fromEntries(ceilings.map((r) => [r.resourceType, r.potentialSavings])),
  estimatedFindings: estimates.length,
  unestimatedFindings: 0,
  bySeverity: { high: 1, medium: 2, low: 2 },
}

/** The demo's home region (a placeholder for the coverage panel). */
export const DEMO_HOME_REGION = 'us-east-1'
