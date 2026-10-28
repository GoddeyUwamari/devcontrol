/**
 * A deterministic mixed fleet for route tests of GET /api/cloudwatch/metrics and
 * GET /api/observability/resources: real organizations, aws_accounts and
 * aws_resources rows in Postgres, and fake AWS clients whose answers depend only
 * on the resource and metric asked about. Placeholders only.
 *
 * Every datapoint carries the fixed timestamp DATAPOINT_AT, so a response is the
 * same on every run apart from the fields a caller masks (capturedAt and the
 * random aws_resources ids).
 */
import type { Pool } from 'pg'
import { EC2Client } from '@aws-sdk/client-ec2'
import { ensureSharedFixtureTable } from './shared-fixture-tables'

// aws_accounts.account_id is unique, so each organization gets its own random account.
export function randomAccountId(): string {
  return String(100000000000 + Math.floor(Math.random() * (899999999999 - 100000000000)))
}
export const OTHER_ACCOUNT_ID = '111122223333'
export const REGION = 'us-east-1'
export const DATAPOINT_AT = new Date('2026-10-28T09:55:00.000Z')

/** What GetMetricData answers for every query on one dimension value. */
export type MetricBehaviour =
  | { kind: 'values'; byMetric: Record<string, number> }
  | { kind: 'empty' }
  | { kind: 'forbidden' }
  | { kind: 'internal_error' }

export interface FleetResource {
  name: string
  type: string
  resourceId: string
  arn: string
  region?: string
  status: string | null
  metadata?: Record<string, unknown>
}

const arnIn = (account: string) => (service: string, rest: string, region = REGION, inAccount = account) => `arn:aws:${service}:${region}:${inAccount}:${rest}`

/** The mixed fleet: one resource per state the observability contract distinguishes. */
export function mixedFleet(accountId: string): FleetResource[] {
  const arn = arnIn(accountId)
  return [
    { name: 'web-running', type: 'ec2', resourceId: 'i-1234567890abcdef0', arn: arn('ec2', 'instance/i-1234567890abcdef0'), status: 'running' },
    { name: 'web-stopped', type: 'ec2', resourceId: 'i-0bbbbbbbbbbbbbbbb', arn: arn('ec2', 'instance/i-0bbbbbbbbbbbbbbbb'), status: 'stopped' },
    { name: 'web-denied', type: 'ec2', resourceId: 'i-0cccccccccccccccc', arn: arn('ec2', 'instance/i-0cccccccccccccccc'), status: 'running' },
    {
      name: 'web-other-region',
      type: 'ec2',
      resourceId: 'i-0dddddddddddddddd',
      arn: arn('ec2', 'instance/i-0dddddddddddddddd', 'eu-west-1'),
      region: 'eu-west-1',
      status: 'running',
    },
    {
      name: 'web-other-account',
      type: 'ec2',
      resourceId: 'i-0eeeeeeeeeeeeeeee',
      arn: arn('ec2', 'instance/i-0eeeeeeeeeeeeeeee', REGION, OTHER_ACCOUNT_ID),
      status: 'running',
    },
    {
      name: 'app-alb',
      type: 'load-balancer',
      resourceId: 'example-alb',
      arn: arn('elasticloadbalancing', 'loadbalancer/app/example-alb/0123456789abcdef'),
      status: 'active',
      metadata: { type: 'application' },
    },
    {
      name: 'net-lb',
      type: 'load-balancer',
      resourceId: 'example-nlb',
      arn: arn('elasticloadbalancing', 'loadbalancer/net/example-nlb/0123456789abcdef'),
      status: 'active',
      metadata: { type: 'network' },
    },
    { name: 'idle-fn', type: 'lambda', resourceId: 'idle-fn', arn: arn('lambda', 'function:idle-fn'), status: 'Active', metadata: { runtime: 'nodejs20.x' } },
    { name: 'example-db', type: 'rds', resourceId: 'example-db', arn: arn('rds', 'db:example-db'), status: 'available', metadata: { engine: 'postgres' } },
    { name: 'orders', type: 'dynamodb', resourceId: 'orders', arn: arn('dynamodb', 'table/orders'), status: 'ACTIVE' },
    { name: 'api-svc', type: 'ecs', resourceId: 'api-svc', arn: arn('ecs', 'service/cluster-a/api-svc'), status: 'ACTIVE' },
    { name: 'k8s', type: 'eks', resourceId: 'k8s', arn: arn('eks', 'cluster/k8s'), status: 'ACTIVE' },
    { name: 'data-vol', type: 'ebs', resourceId: 'vol-0123456789abcdef0', arn: arn('ec2', 'volume/vol-0123456789abcdef0'), status: 'in-use', metadata: { volume_type: 'gp3' } },
    {
      name: 'cdn',
      type: 'cloudfront',
      resourceId: 'E2EXAMPLE1',
      arn: `arn:aws:cloudfront::${accountId}:distribution/E2EXAMPLE1`,
      region: 'global',
      status: 'active',
      metadata: { is_enabled: true },
    },
    { name: 'aurora-main', type: 'aurora', resourceId: 'aurora-main', arn: arn('rds', 'cluster:aurora-main'), status: 'available' },
    { name: 'logs-bucket', type: 's3', resourceId: 'logs-bucket', arn: 'arn:aws:s3:::logs-bucket', status: 'active' },
    { name: 'rest-api', type: 'api-gateway', resourceId: 'abcdef1234', arn: arn('apigateway', '/restapis/abcdef1234', REGION, ''), status: 'active' },
  ]
}

/** GetMetricData behaviour per dimension value, for the mixed fleet. */
export function mixedMetrics(): Record<string, MetricBehaviour> {
  return {
    'i-1234567890abcdef0': { kind: 'values', byMetric: { StatusCheckFailed: 0, CPUUtilization: 12 } },
    'i-0bbbbbbbbbbbbbbbb': { kind: 'empty' },
    'i-0cccccccccccccccc': { kind: 'forbidden' },
    'i-0dddddddddddddddd': { kind: 'values', byMetric: { StatusCheckFailed: 0, CPUUtilization: 5 } },
    'i-0eeeeeeeeeeeeeeee': { kind: 'values', byMetric: { StatusCheckFailed: 0, CPUUtilization: 5 } },
    'app/example-alb/0123456789abcdef': { kind: 'values', byMetric: { TargetResponseTime: 0.74, RequestCount: 120 } },
    'idle-fn': { kind: 'empty' },
    orders: { kind: 'empty' },
    E2EXAMPLE1: { kind: 'values', byMetric: { TotalErrorRate: 0.01, '4xxErrorRate': 0.01, '5xxErrorRate': 0 } },
    'aurora-main': { kind: 'values', byMetric: { CPUUtilization: 30 } },
  }
}

export interface InsertedFleet {
  orgId: string
  accountId: string
  idsByName: Record<string, string>
}

/** Inserts an organization, its one active account and the fleet (built for that account). */
export async function insertFleetOrg(
  pool: Pool,
  label: string,
  fleetFor: (accountId: string) => FleetResource[],
  accountId = randomAccountId()
): Promise<InsertedFleet> {
  const fleet = fleetFor(accountId)
  await ensureSharedFixtureTable(pool, 'aws_accounts')
  const tag = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { rows } = await pool.query(`INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`, [`obs-fixture-${tag}`])
  const orgId = rows[0].id as string
  await pool.query(
    `INSERT INTO aws_accounts (account_id, role_arn, status, external_id, region, org_id)
     VALUES ($1, $2, 'active', 'ext-id-test', $3, $4)`,
    [accountId, `arn:aws:iam::${accountId}:role/DevControlTest`, REGION, orgId]
  )
  const idsByName: Record<string, string> = {}
  for (const r of fleet) {
    const { rows: inserted } = await pool.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [orgId, r.arn, r.resourceId, r.name, r.type, r.region ?? REGION, r.status, r.metadata ? JSON.stringify(r.metadata) : null]
    )
    idsByName[r.name] = inserted[0].id
  }
  return { orgId, accountId, idsByName }
}

/** Removes what insertFleetOrg created (aws_accounts does not cascade from organizations in every fixture). */
export async function deleteFleetOrgs(pool: Pool, orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) return
  await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds])
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgIds])
}

export interface FakeAwsOptions {
  metrics: Record<string, MetricBehaviour>
  // Throw this from every GetMetricData request (a whole-request failure).
  getMetricDataError?: Error
  accountId: string
  // The timestamp every datapoint carries (default DATAPOINT_AT).
  datapointAt?: Date
  // VolumeStatus.Status every EBS volume reports (default 'ok').
  volumeStatus?: string
}

/** Fake clients in the shape AWSClientFactory.createClients returns. */
export function fakeClients(options: FakeAwsOptions): any {
  const cloudWatch = {
    send: async (command: any) => {
      if (command.constructor.name !== 'GetMetricDataCommand') throw new Error(`unexpected ${command.constructor.name}`)
      if (options.getMetricDataError) throw options.getMetricDataError
      const queries = command.input.MetricDataQueries ?? []
      return {
        MetricDataResults: queries.map((q: any) => {
          const metric = q.MetricStat.Metric
          const dimValue = metric.Dimensions?.[0]?.Value
          const behaviour = options.metrics[dimValue] ?? { kind: 'empty' }
          if (behaviour.kind === 'forbidden') return { Id: q.Id, StatusCode: 'Forbidden', Timestamps: [], Values: [] }
          if (behaviour.kind === 'internal_error') return { Id: q.Id, StatusCode: 'InternalError', Timestamps: [], Values: [] }
          if (behaviour.kind === 'empty') return { Id: q.Id, StatusCode: 'Complete', Timestamps: [], Values: [] }
          const value = behaviour.byMetric[metric.MetricName]
          if (value === undefined) return { Id: q.Id, StatusCode: 'Complete', Timestamps: [], Values: [] }
          return { Id: q.Id, StatusCode: 'Complete', Timestamps: [options.datapointAt ?? DATAPOINT_AT], Values: [value] }
        }),
      }
    },
  }
  return {
    cloudWatch,
    getCloudWatchClientForRegion: () => cloudWatch,
    ecs: {
      send: async () => ({ services: [{ status: 'ACTIVE', desiredCount: 2, runningCount: 2, pendingCount: 0 }], failures: [] }),
    },
    eks: {
      send: async () => ({ cluster: { status: 'ACTIVE', version: '1.30', health: { issues: [] } } }),
    },
    // A real EC2Client (the SDK's paginators refuse any other object) whose send is replaced.
    ec2: Object.assign(new EC2Client({ region: REGION }), {
      send: async (command: any) => ({
        VolumeStatuses: (command.input.VolumeIds ?? []).map((id: string) => ({ VolumeId: id, VolumeStatus: { Status: options.volumeStatus ?? 'ok' }, Events: [] })),
      }),
    }),
    rds: {
      send: async () => ({
        DBClusters: [
          { DBClusterIdentifier: 'aurora-main', Engine: 'aurora-postgresql', Status: 'available', DBClusterMembers: [{ IsClusterWriter: true }] },
        ],
      }),
    },
    region: REGION,
    enabled: true,
    accountId: options.accountId,
  }
}

/** The response with run-dependent fields replaced, so it compares equal across runs. */
export function maskRunDependent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskRunDependent)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === 'capturedAt' || k === 'captured_at') out[k] = '<captured-at>'
      else if (k === 'accountId') out[k] = '<account-id>'
      else if (k === 'resourceDbId') out[k] = '<aws-resources-id>'
      else out[k] = maskRunDependent(v)
    }
    return out
  }
  return value
}
