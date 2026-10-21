/**
 * Demo and sales-demo data for the redesigned Services page (Q6): one
 * placeholder fixture, shown under a SAMPLE DATA banner. Placeholder names
 * only (example-*, owner-*@example.com); issue strings are the scanner's own
 * wording; every number is computed from the rows below, so tiles, counts,
 * chips and lists agree. Nothing here is requested from an API.
 */
import type { AWSService, AWSServicesStats, ResourceOwnership, ServicesCoverage } from '@/lib/services/aws-services.service'
import type { CostSummary, RegisteredService } from '@/lib/types'

export const SAMPLE_DATA_BANNER = 'SAMPLE DATA: illustrative, not live AWS inventory.'

const HOME_REGION = 'us-east-1'

type Row = {
  name: string
  type: string
  region: string
  environment: string | null
  owner?: string
  team?: string
  ownership: ResourceOwnership
  attention?: { severity: 'critical' | 'high' | 'medium'; reason: string; cause: 'finding' | 'cost_recommendation' | 'status' }
  status?: AWSService['status']
}

const ROWS: Row[] = [
  { name: 'example-bastion', type: 'ec2', region: HOME_REGION, environment: 'production', ownership: 'unowned',
    attention: { severity: 'critical', cause: 'finding', reason: 'Security group "example-bastion-sg" (sg-00000000000000000) allows SSH (port 22) from anywhere (0.0.0.0/0)' } },
  { name: 'example-orders-db', type: 'rds', region: HOME_REGION, environment: 'production', owner: 'owner-y1@example.com', team: 'payments', ownership: 'owned', status: 'critical',
    attention: { severity: 'critical', cause: 'status', reason: 'Resource in a failed or terminated state' } },
  { name: 'example-api-legacy', type: 'ec2', region: HOME_REGION, environment: 'production', team: 'platform', ownership: 'owned',
    attention: { severity: 'high', cause: 'cost_recommendation', reason: 'Idle Instance' } },
  { name: 'example-data-volume', type: 'ebs', region: HOME_REGION, environment: 'staging', ownership: 'unowned',
    attention: { severity: 'high', cause: 'cost_recommendation', reason: 'Unattached EBS Volume' } },
  { name: 'example-batch-runner', type: 'ec2', region: HOME_REGION, environment: 'staging', owner: 'owner-d2@example.com', team: 'data', ownership: 'owned', status: 'warning',
    attention: { severity: 'medium', cause: 'status', reason: 'Resource is stopped or degraded' } },
  { name: 'example-api-cron', type: 'lambda', region: HOME_REGION, environment: 'dev', owner: 'owner-p2@example.com', team: 'platform', ownership: 'owned' },
  { name: 'example-events-queue', type: 'sqs', region: HOME_REGION, environment: 'production', team: 'platform', ownership: 'owned' },
  { name: 'example-alerts', type: 'sns', region: HOME_REGION, environment: null, ownership: 'unowned' },
  { name: 'example-exports', type: 's3', region: HOME_REGION, environment: 'production', owner: 'owner-d1@example.com', team: 'data', ownership: 'owned' },
  { name: 'example-web-assets', type: 's3', region: 'us-west-2', environment: 'production', owner: 'owner-p1@example.com', team: 'platform', ownership: 'owned' },
  { name: 'example-logs-archive', type: 's3', region: 'eu-west-1', environment: 'production', ownership: 'unknown' },
  { name: 'example-cdn', type: 'cloudfront', region: 'global', environment: 'production', ownership: 'unknown' },
]

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const

function countBy<T>(items: T[], key: (item: T) => string): { key: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1))
}

export interface ServicesDemoFixture {
  services: AWSService[]
  /** The needs-attention rows in the server's order: severity, then name. */
  attention: AWSService[]
  stats: AWSServicesStats
  coverage: ServicesCoverage
  registered: RegisteredService[]
  costSummary: CostSummary
}

export function servicesDemoFixture(now: number = Date.now()): ServicesDemoFixture {
  const seen = new Date(now - 48 * 60_000).toISOString()
  const services: AWSService[] = ROWS.map((row, i) => ({
    id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
    name: row.name,
    type: row.type,
    environment: row.environment,
    region: null as unknown as string,
    aws_region: row.region,
    status: row.status ?? (row.type === 's3' || row.type === 'sns' || row.type === 'cloudfront' || row.type === 'sqs' ? 'unknown' : 'healthy'),
    uptime: null as unknown as number,
    owner: row.ownership === 'unknown' ? null : row.owner ?? null,
    team: row.ownership === 'unknown' ? null : row.team ?? null,
    monthly_cost: null,
    last_deployed: seen,
    last_seen_at: seen,
    metadata: {},
    priority_severity: row.attention?.severity ?? null,
    needs_attention: !!row.attention,
    reason: row.attention?.reason ?? null,
    ownership: row.ownership,
    attention_cause: row.attention?.cause ?? null,
  }))

  const attention = services
    .filter((s) => s.needs_attention)
    .sort((a, b) => SEVERITY_RANK[a.priority_severity!] - SEVERITY_RANK[b.priority_severity!] || a.name.localeCompare(b.name, 'en'))
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const s of attention) bySeverity[s.priority_severity!]++
  const ownership = { owned: 0, unowned: 0, unknown: 0 }
  for (const s of services) ownership[s.ownership!]++
  const unknownByType = Object.fromEntries(countBy(services.filter((s) => s.ownership === 'unknown'), (s) => s.type).map((c) => [c.key, c.count]))
  const regions = countBy(services, (s) => s.aws_region!).map((c) => ({ region: c.key, count: c.count }))
  const teams = countBy(services.filter((s) => s.ownership !== 'unknown' && s.team), (s) => s.team!).map((c) => ({ team: c.key, count: c.count }))

  const stats: AWSServicesStats = {
    total: services.length,
    healthy: services.length - attention.length,
    needs_attention: attention.length,
    avg_uptime: null,
    aws_accounts_connected: 1,
    attention_by_severity: bySeverity,
    ownership,
    unknown_by_type: unknownByType,
    regions,
    teams: { top: teams.slice(0, 3), all: teams, total_teams: teams.length },
    mapped_to_service: 0,
  }

  const s3Regions = countBy(services.filter((s) => s.type === 's3'), (s) => s.aws_region!).map((c) => ({ region: c.key, count: c.count }))
  const coverage: ServicesCoverage = {
    account: { connected: true, status: 'active', home_region: HOME_REGION },
    scope: {
      home_region: { region: HOME_REGION, count: services.filter((s) => s.aws_region === HOME_REGION).length },
      s3: { in_last_scan: true, regions: s3Regions },
      cloudfront: { in_last_scan: true, count: services.filter((s) => s.type === 'cloudfront').length },
      enabled_regions: { known: false, count: null },
    },
    last_successful_scan_at: seen,
    last_scan: { status: 'completed', started_at: new Date(now - 50 * 60_000).toISOString(), completed_at: seen, warnings: [] },
    resource_types: [...new Set(services.map((s) => s.type))].sort(),
    tags_unknown_by_type: unknownByType,
    regions,
    total: services.length,
  }

  const created = new Date(now - 30 * 24 * 60 * 60_000).toISOString()
  const registered: RegisteredService[] = [
    { id: 'demo-svc-1', name: 'example-checkout-api', owner: 'owner-y1@example.com', teamId: null, teamName: 'payments', githubUrl: 'https://github.com/example-org/example-checkout-api', createdAt: created },
    { id: 'demo-svc-2', name: 'example-events-pipeline', owner: 'owner-d1@example.com', teamId: null, teamName: 'data', githubUrl: null, createdAt: created },
    { id: 'demo-svc-3', name: 'example-web-app', owner: 'owner-p1@example.com', teamId: null, teamName: null, githubUrl: 'https://github.com/example-org/example-web-app', createdAt: created },
  ]

  const today = new Date(now)
  const yesterday = new Date(now - 24 * 60 * 60_000).toISOString().slice(0, 10)
  const monthStart = `${today.toISOString().slice(0, 7)}-01`
  const costSummary: CostSummary = {
    spend: {
      state: 'available', source: 'sample', provenance: 'actual', asOf: today.toISOString(), coverage: null, reason: null,
      data: { amount: 1234.56, basis: 'billed_month_to_date', lastDayInProgress: true, finishedThrough: yesterday >= monthStart ? yesterday : null },
    },
    monthOverMonth: {
      state: 'unavailable', source: 'sample', provenance: null, asOf: null, coverage: null, reason: null, data: null,
      period: { kind: 'range', start: monthStart, endExclusive: today.toISOString().slice(0, 10) },
    },
  }

  return { services, attention, stats, coverage, registered, costSummary }
}
