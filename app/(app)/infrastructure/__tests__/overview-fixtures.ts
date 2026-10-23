/**
 * Responses for the Infrastructure Overview tests. Coverage is production's
 * response of Oct 22 (S/__tests__/m6-fixtures.tsx, reused); the other
 * responses are shaped like the API's, with distinctive numbers so a sum of
 * two sources can be told apart from either.
 */
import type { AWSService, AWSServicesPage, AWSServicesStats, ServicesCoverage } from '@/lib/services/aws-services.service'
import type { AccountSecurityFinding } from '@/lib/services/account-security-findings.service'
import type { CostSummary, RecommendationStats } from '@/lib/types'
import type { Loadable, OverviewInputs } from '../overview/overviewModel'
import { prodCoverage } from '../../services/__tests__/m6-fixtures'

export const NOW = Date.parse('2026-10-23T15:00:00Z')
export const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

export const ready = <T,>(data: T): Loadable<T> => ({ status: 'ready', data })
export const LOADING = { status: 'loading' } as const
export const ERROR = { status: 'error' } as const

export function coverage(o: Partial<ServicesCoverage> = {}): ServicesCoverage {
  return prodCoverage(NOW, {}, o)
}

export function noAccountCoverage(): ServicesCoverage {
  return {
    account: { connected: false, status: null, home_region: null },
    scope: { home_region: null, s3: { in_last_scan: false, regions: [] }, cloudfront: { in_last_scan: false, count: 0 }, enabled_regions: { known: false, count: null } },
    region_status: [], scan_in_progress: null, last_completed_scan: null, last_successful_scan_at: null, last_scan: null,
    resource_types: null, tags_unknown_by_type: {}, regions: [], total: 0,
  }
}

export const STATS: AWSServicesStats = {
  total: 9, healthy: 3, needs_attention: 6, avg_uptime: null, aws_accounts_connected: 1,
  findings_by_severity: { critical: 1, high: 2, medium: 5, low: 0 },
  attention_reasons: { with_finding: 3, with_cost_recommendation: 1, stopped_or_degraded: 1, failed: 1 },
  attention_by_severity: { critical: 2, high: 3, medium: 1, low: 0 },
  ownership: { owned: 6, unowned: 3, unknown: 0 },
  unknown_by_type: {},
}

export const QUIET_STATS: AWSServicesStats = {
  ...STATS, healthy: 9, needs_attention: 0,
  findings_by_severity: { critical: 0, high: 0, medium: 4, low: 1 },
  attention_reasons: { with_finding: 0, with_cost_recommendation: 0, stopped_or_degraded: 0, failed: 0 },
  attention_by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
}

export function service(id: string, o: Partial<AWSService>): AWSService {
  return {
    id, name: id, type: 'ec2', environment: null, region: 'us-east-1', status: 'healthy', uptime: 0, owner: null, team: null,
    monthly_cost: null, last_deployed: null, metadata: {}, priority_severity: null, needs_attention: true, reason: null,
    aws_region: 'us-east-1', last_seen_at: hoursAgo(2), ownership: 'unowned', attention_cause: null, ...o,
  }
}

/** One row per cause, in the server's order (severity, then name). */
export const ATTENTION_ROWS: AWSService[] = [
  service('db-prod', { type: 'rds', priority_severity: 'critical', attention_cause: 'finding', reason: 'RDS instance is publicly accessible', monthly_cost: 50 }),
  service('db-stopped', { type: 'rds', status: 'critical', priority_severity: 'critical', attention_cause: 'status', reason: 'Resource in a failed or terminated state', monthly_cost: 30 }),
  service('bucket-a', { type: 's3', aws_region: 'us-east-1', priority_severity: 'high', attention_cause: 'finding', reason: 'S3 bucket allows public read', monthly_cost: 5.37 }),
  service('vol-x', { type: 'ebs', priority_severity: 'high', attention_cause: 'cost_recommendation', reason: 'Unattached EBS volume', monthly_cost: 8 }),
  service('web-1', { priority_severity: 'high', attention_cause: 'finding', reason: 'Security group open to the internet', monthly_cost: 200 }),
  service('worker', { status: 'warning', priority_severity: 'medium', attention_cause: 'status', reason: 'Resource is stopped or degraded', monthly_cost: null }),
]

export function attentionPage(rows: AWSService[] = ATTENTION_ROWS, total = rows.length): AWSServicesPage {
  return { services: rows, pagination: { page: 1, limit: 100, total, total_pages: 1, has_more: false }, counts: { needs_attention: total, no_flagged_issues: 3 } }
}

export function finding(id: string, o: Partial<AccountSecurityFinding>): AccountSecurityFinding {
  return {
    id, organization_id: 'org-test', finding_key: id, category: 'networking', severity: 'high', title: `Finding ${id}`,
    recommendation: `Fix ${id}`, resource_identifier: `sg-${id}`, region: 'us-east-1', status: 'active',
    detected_at: hoursAgo(30), last_seen_at: hoursAgo(2), resolved_at: null, disposition: null, disposition_actor_id: null,
    disposition_at: null, disposition_note: null, evidence: null, created_at: hoursAgo(30), updated_at: hoursAgo(2),
    derived_status: 'active', framework_mapping: null, ...o,
  }
}

/** 4 open (critical, high acknowledged, medium, low) + 2 not open (dismissed, accepted risk). */
export const ACCOUNT_FINDINGS: AccountSecurityFinding[] = [
  finding('sg-open', { severity: 'critical', title: 'SSH open to the world', recommendation: 'Restrict port 22' }),
  finding('iam-mfa', { category: 'iam', severity: 'high', region: null, resource_identifier: 'alice', title: 'Console user without MFA', recommendation: 'Enable MFA for alice', derived_status: 'acknowledged', disposition: 'acknowledged' }),
  finding('iam-dismissed', { category: 'iam', severity: 'high', region: null, resource_identifier: 'bob', derived_status: 'dismissed', disposition: 'dismissed' }),
  finding('sg-accepted', { severity: 'high', derived_status: 'accepted_risk', disposition: 'accepted_risk' }),
  finding('sg-medium', { severity: 'medium' }),
  finding('sg-low', { severity: 'low' }),
]

export function billedSummary(o: { amount?: number; top?: { service: string; amount: number; sharePercent: number | null }[] | null } = {}): CostSummary {
  const amount = o.amount ?? 1000
  return {
    spend: {
      state: 'available', source: 'cost_explorer', provenance: 'actual', asOf: hoursAgo(1), coverage: null, reason: null,
      data: {
        amount, basis: 'billed_month_to_date', lastDayInProgress: true, finishedThrough: '2026-10-21',
        topServices: o.top === undefined ? [
          { service: 'Amazon Elastic Compute Cloud - Compute', amount: 400, sharePercent: 40 },
          { service: 'Amazon Relational Database Service', amount: 300, sharePercent: 30 },
          { service: 'Amazon Simple Storage Service', amount: 100, sharePercent: 10 },
          { service: 'AWS Lambda', amount: 50, sharePercent: 5 },
          { service: 'Amazon CloudFront', amount: 25, sharePercent: 2.5 },
        ] : o.top,
      },
    },
    monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: null, data: null },
  }
}

export function estimatedSummary(): CostSummary {
  return {
    spend: {
      state: 'available', source: 'inventory', provenance: 'estimated', asOf: hoursAgo(1), coverage: null, reason: 'Cost Explorer is not enabled',
      data: { amount: 777.77, basis: 'estimated_monthly_run_rate', lastDayInProgress: false, finishedThrough: null, topServices: null },
    },
    monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: null, data: null },
  }
}

export const SAVINGS: RecommendationStats = {
  totalRecommendations: 3, activeRecommendations: 3, totalPotentialSavings: 123.45, potentialSavingsByResourceType: { EBS: 123.45 },
  potentialSavingsCeiling: 41.27, potentialSavingsCeilingByResourceType: { S3: 41.27 }, bySeverity: { high: 1, medium: 0, low: 2 },
}

export const NO_SAVINGS: RecommendationStats = {
  totalRecommendations: 0, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
  potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 0 },
}

export function inputs(o: Partial<OverviewInputs> = {}): OverviewInputs {
  return {
    coverage: ready(coverage()),
    stats: ready(STATS),
    attention: ready(attentionPage()),
    accountFindings: ready(ACCOUNT_FINDINGS),
    costSummary: ready(billedSummary()),
    savings: ready(SAVINGS),
    inTabWarnings: [],
    regionsLinkAvailable: false,
    ...o,
  }
}
