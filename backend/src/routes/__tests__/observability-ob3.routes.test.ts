/**
 * OB3 through the real sweep: GET /api/observability/resources and the legacy
 * GET /api/cloudwatch/metrics for a fleet whose every GetMetricData answer is split
 * across two NextToken pages -- so each caller of the shared batch fetch (EC2, ALB
 * both windows, Lambda, DynamoDB, RDS, CloudFront, Aurora) is shown to read every
 * page, not just the last one, and none is left unknown/query_failed by OB2's
 * stopgap. Also: the shape of the new queries (one LoadBalancer dimension for the
 * three 5xx-rule queries; no query for an Aurora member instance), the SLO path's
 * metric set unchanged, organization isolation, and inventory_capped unaffected by
 * metric paging. Placeholders only.
 */
import express from 'express'
import http from 'http'
import { Pool } from 'pg'
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch'
import observabilityResourcesRoutes from '../observability-resources.routes'
import cloudwatchRoutes from '../cloudwatch.routes'
import { authService } from '../../services/auth.service'
import { AWSClientFactory } from '../../services/aws-client-factory.service'
import awsCostService from '../../services/aws-cost.service'
import { CloudWatchService, resourceTypeRegistry } from '../../services/cloudwatch.service'
import { ensureSharedFixtureTable } from './shared-fixture-tables'
import { FleetResource, REGION, deleteFleetOrgs, fakeClients, insertFleetOrg } from './observability-fleet-fixture'

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  }
}

const pool = new Pool(dbConfig())
const createdOrgIds: string[] = []
const createdUserIds: string[] = []
let server: http.Server
let baseUrl: string

const GIB = 1024 ** 3
const PAGE_1_AT = new Date('2026-10-29T09:50:00.000Z')
const PAGE_2_AT = new Date('2026-10-29T09:55:00.000Z')

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/observability', observabilityResourcesRoutes)
  app.use('/api/cloudwatch', cloudwatchRoutes)
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`
  await ensureSharedFixtureTable(pool, 'aws_accounts')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await deleteFleetOrgs(pool, createdOrgIds)
  if (createdUserIds.length > 0) await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
  await pool.end()
})

beforeEach(() => {
  jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 42 } as any)
})
afterEach(() => jest.restoreAllMocks())

async function signInAs(orgId: string): Promise<void> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'OB3 Route User') RETURNING id`,
    [`ob3-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`]
  )
  createdUserIds.push(rows[0].id)
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active) VALUES ($1, $2, 'viewer', NOW(), true)`,
    [orgId, rows[0].id]
  )
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: rows[0].id,
    email: 'ob3-route@example.com',
    organizationId: orgId,
    role: 'viewer',
    type: 'access',
  } as any)
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer test-token' } })
  return { status: res.status, body: await res.json() }
}

const byName = (resources: any[]) => Object.fromEntries(resources.map((r) => [r.name, r]))

/** One resource of each type the batch fetch serves, plus an Aurora member instance. */
function pagedFleet(accountId: string, prefix = ''): FleetResource[] {
  const arn = (service: string, rest: string) => `arn:aws:${service}:${REGION}:${accountId}:${rest}`
  return [
    { name: `${prefix}web`, type: 'ec2', resourceId: 'i-1234567890abcdef0', arn: arn('ec2', 'instance/i-1234567890abcdef0'), status: 'running' },
    {
      name: `${prefix}app-alb`,
      type: 'load-balancer',
      resourceId: 'example-alb',
      arn: arn('elasticloadbalancing', 'loadbalancer/app/example-alb/0123456789abcdef'),
      status: 'active',
      metadata: { type: 'application' },
    },
    { name: `${prefix}fn`, type: 'lambda', resourceId: 'example-fn', arn: arn('lambda', 'function:example-fn'), status: 'Active', metadata: { runtime: 'nodejs20.x' } },
    { name: `${prefix}orders`, type: 'dynamodb', resourceId: 'orders', arn: arn('dynamodb', 'table/orders'), status: 'ACTIVE' },
    { name: `${prefix}example-db`, type: 'rds', resourceId: 'example-db', arn: arn('rds', 'db:example-db'), status: 'available', metadata: { engine: 'postgres', allocated_storage: 100 } },
    {
      name: `${prefix}aurora-member`,
      type: 'rds',
      resourceId: 'aurora-member-1',
      arn: arn('rds', 'db:aurora-member-1'),
      status: 'available',
      metadata: { engine: 'aurora-postgresql', allocated_storage: 1 },
    },
    {
      name: `${prefix}cdn`,
      type: 'cloudfront',
      resourceId: 'E2EXAMPLE1',
      arn: `arn:aws:cloudfront::${accountId}:distribution/E2EXAMPLE1`,
      region: 'global',
      status: 'active',
      metadata: { is_enabled: true },
    },
    { name: `${prefix}aurora-main`, type: 'aurora', resourceId: 'aurora-main', arn: arn('rds', 'cluster:aurora-main'), status: 'available' },
  ]
}

// Each metric's two datapoints, page 1 then page 2, per dimension value. A metric not
// listed completes with no datapoints on page 1.
const TWO_PAGE_SERIES: Record<string, Record<string, [number, number]>> = {
  'i-1234567890abcdef0': { StatusCheckFailed: [0, 0], CPUUtilization: [10, 20] },
  'app/example-alb/0123456789abcdef': {
    TargetResponseTime: [0.1, 0.3],
    RequestCount: [60, 60],
    HTTPCode_Target_5XX_Count: [1, 1],
    HTTPCode_ELB_5XX_Count: [0, 1],
  },
  'example-fn': { Invocations: [50, 50], Errors: [0, 1], Duration: [10, 30], Throttles: [0, 0] },
  orders: { SystemErrors: [0, 0], ThrottledRequests: [0, 0] },
  'example-db': { CPUUtilization: [10, 30], DatabaseConnections: [2, 4], FreeStorageSpace: [60 * GIB, 5 * GIB] },
  E2EXAMPLE1: { TotalErrorRate: [0.01, 0.01], '4xxErrorRate': [0.01, 0.01], '5xxErrorRate': [0, 0] },
  'aurora-main': { CPUUtilization: [30, 40] },
}

interface SentQuery {
  id: string
  metricName: string
  stat: string
  period: number
  dimensions: Array<{ Name: string; Value: string }>
  startTime: number
  endTime: number
}

/** A CloudWatch fake that answers each request in two NextToken pages, recording every query it was sent. */
function twoPageCloudWatch(series: Record<string, Record<string, [number, number]>>, sent: SentQuery[]) {
  return {
    send: async (command: any) => {
      if (command.constructor.name !== 'GetMetricDataCommand') throw new Error(`unexpected ${command.constructor.name}`)
      const queries = command.input.MetricDataQueries as any[]
      const pointsOf = (q: any) => series[q.MetricStat.Metric.Dimensions?.[0]?.Value]?.[q.MetricStat.Metric.MetricName]
      if (!command.input.NextToken) {
        for (const q of queries) {
          sent.push({
            id: q.Id,
            metricName: q.MetricStat.Metric.MetricName,
            stat: q.MetricStat.Stat,
            period: q.MetricStat.Period,
            dimensions: q.MetricStat.Metric.Dimensions,
            startTime: command.input.StartTime.getTime(),
            endTime: command.input.EndTime.getTime(),
          })
        }
        return {
          MetricDataResults: queries.map((q) => {
            const points = pointsOf(q)
            return points
              ? { Id: q.Id, StatusCode: 'PartialData', Timestamps: [PAGE_1_AT], Values: [points[0]] }
              : { Id: q.Id, StatusCode: 'Complete', Timestamps: [], Values: [] }
          }),
          NextToken: 'page-2',
        }
      }
      return {
        MetricDataResults: queries
          .filter((q) => pointsOf(q))
          .map((q) => ({ Id: q.Id, StatusCode: 'Complete', Timestamps: [PAGE_2_AT], Values: [pointsOf(q)![1]] })),
      }
    },
  }
}

function pagedClients(accountId: string, sent: SentQuery[]) {
  const cloudWatch = twoPageCloudWatch(TWO_PAGE_SERIES, sent)
  return { ...fakeClients({ metrics: {}, accountId }), cloudWatch, getCloudWatchClientForRegion: () => cloudWatch }
}

async function pagedOrg(label: string, prefix = '') {
  const fleet = await insertFleetOrg(pool, label, (accountId) => pagedFleet(accountId, prefix))
  createdOrgIds.push(fleet.orgId)
  return fleet
}

describe('OB3: every GetMetricData caller reads every page', () => {
  it('each type is judged on both pages and none is unknown/query_failed; collection complete', async () => {
    const { orgId, accountId } = await pagedOrg('paged')
    await signInAs(orgId)
    const sent: SentQuery[] = []
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(pagedClients(accountId, sent) as any)

    const { status, body } = await get('/observability/resources?range=1h&pageSize=100')
    expect(status).toBe(200)
    expect(body.data.collection).toBe('complete')
    const r = byName(body.data.resources)
    const state = (name: string) => [r[name].check_status, r[name].unknown_reason]

    // EC2: CPU (10 + 20) / 2 = 15 -- the last page alone would say 20.
    expect(state('web')).toEqual(['passing', null])
    expect(r.web.metrics).toContainEqual({ label: 'CPU', value: 15, unit: '%', statistic: 'Average', window: '1h' })
    expect(r.web.last_seen).toBe(PAGE_2_AT.toISOString())
    // ALB: 120 requests, 3 5xx (2 target + 1 ELB) = 2.5% -> needs_attention. The last
    // page alone (60 requests, 2 5xx) would be not_enough_traffic.
    expect(state('app-alb')).toEqual(['needs_attention', null])
    expect(r['app-alb'].metrics).toEqual(
      expect.arrayContaining([
        { label: 'Avg latency', value: 200, unit: 'ms', statistic: 'Average', window: '1h' },
        { label: '5xx errors', value: 3, statistic: 'Sum', window: '1h' },
        { label: '5xx rate', value: 2.5, unit: '%', statistic: 'Sum', window: '1h' },
      ])
    )
    // Lambda: 100 invocations, 1 error = 1% -> passing; no throttles in either page.
    expect(state('fn')).toEqual(['passing', null])
    expect(r.fn.metrics).toContainEqual({ label: 'Throttles', value: 0, statistic: 'Sum', window: '1h' })
    expect(state('orders')).toEqual(['passing', null])
    // RDS: the lowest free storage (5 GiB, page 2) of 100 GiB is 5% -> needs_attention.
    expect(state('example-db')).toEqual(['needs_attention', null])
    expect(r['example-db'].metrics).toEqual([
      { label: 'CPU', value: 20, unit: '%', statistic: 'Average', window: '1h' },
      { label: 'Connections', value: 3, statistic: 'Average', window: '1h' },
      { label: 'Connections (max)', value: 4, statistic: 'Maximum', window: '1h' },
      { label: 'Free storage', value: 5, unit: 'GiB', statistic: 'Minimum', window: '1h' },
      { label: 'Free storage', value: 5, unit: '% of allocated', statistic: 'Minimum', window: '1h' },
    ])
    expect(state('cdn')).toEqual(['passing', null])
    expect(r.cdn.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ label: '4xx rate' })]))
    expect(state('aurora-main')).toEqual(['passing', null])
    expect(r['aurora-main'].metrics).toContainEqual({ label: 'CPU', value: 35, unit: '%', statistic: 'Average', window: '1h' })
    expect(state('aurora-member')).toEqual(['not_measured', null])
  })

  it('the legacy route carries the values over both pages (CPU 15, not the last page\'s 20)', async () => {
    const { orgId, accountId } = await pagedOrg('paged-legacy')
    await signInAs(orgId)
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(pagedClients(accountId, []) as any)

    const { status, body } = await get('/cloudwatch/metrics?range=1h&pageSize=100')
    expect(status).toBe(200)
    const s = byName(body.data.services)
    expect(s.web.metrics).toEqual([{ label: 'CPU', value: 15, unit: '%' }])
    expect(s.web.uptime).toBe(100)
    expect(s['app-alb'].responseTimeMs).toBe(200)
    // 120 requests over the 60-minute window; target-only legacy error rate 2/120.
    expect(s['app-alb'].metrics).toEqual([
      { label: 'Requests/min', value: 2 },
      { label: 'Error rate', value: 1.67, unit: '%' },
    ])
    expect(s.fn.errorRate).toBe(1)
    expect(s.fn.metrics).toEqual([{ label: 'Invocations', value: 100 }, { label: 'Errors', value: 1 }])
    // The legacy RDS row is unchanged by OB3: inventory-only, not monitored.
    expect(s['example-db']).toMatchObject({ status: 'healthy', monitored: false, uptime: null })
    expect(s['example-db'].metrics).toBeUndefined()
    expect(body.data.avgResponseTimeMs).toBe(200)
    expect(body.data.requestsPerMinute).toBe(2)
  })
})

describe('OB3 query shape', () => {
  it('the three 5xx-rule queries share one request, one LoadBalancer dimension, one period; no TargetGroup anywhere', async () => {
    const { orgId, accountId } = await pagedOrg('shape')
    await signInAs(orgId)
    const sent: SentQuery[] = []
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(pagedClients(accountId, sent) as any)
    await get('/observability/resources?range=1h&pageSize=100')

    const albQueries = sent.filter((q) => ['RequestCount', 'HTTPCode_Target_5XX_Count', 'HTTPCode_ELB_5XX_Count'].includes(q.metricName))
    expect(albQueries.map((q) => q.metricName).sort()).toEqual(['HTTPCode_ELB_5XX_Count', 'HTTPCode_Target_5XX_Count', 'RequestCount'])
    for (const q of albQueries) {
      expect(q.dimensions).toEqual([{ Name: 'LoadBalancer', Value: 'app/example-alb/0123456789abcdef' }])
      expect(q.stat).toBe('Sum')
      expect(q.period).toBe(albQueries[0].period)
      expect([q.startTime, q.endTime]).toEqual([albQueries[0].startTime, albQueries[0].endTime])
    }
    expect(albQueries[0].endTime - albQueries[0].startTime).toBe(60 * 60 * 1000)
    expect(sent.some((q) => q.dimensions.some((d) => d.Name === 'TargetGroup'))).toBe(false)

    const rdsQueries = sent.filter((q) => q.dimensions[0]?.Name === 'DBInstanceIdentifier')
    expect(rdsQueries.map((q) => `${q.metricName}/${q.stat}`).sort()).toEqual([
      'CPUUtilization/Average',
      'DatabaseConnections/Average',
      'DatabaseConnections/Maximum',
      'FreeStorageSpace/Minimum',
    ])
    // The Aurora member instance is never queried; its cluster row measures it.
    expect(rdsQueries.every((q) => q.dimensions[0].Value === 'example-db')).toBe(true)
    expect(sent.find((q) => q.metricName === 'Throttles')).toMatchObject({ stat: 'Sum', dimensions: [{ Name: 'FunctionName', Value: 'example-fn' }] })
  })

  it('the SLO path (evaluateResource) fetches exactly the pre-OB3 metrics: no Throttles, no ELB 5xx', async () => {
    const service = new CloudWatchService()
    const fetched: string[] = []
    jest.spyOn(service as any, 'getMetricStat').mockImplementation(async (...args: any[]) => {
      fetched.push(`${args[2]}/${args[7]}`)
      return 1
    })
    const client = new CloudWatchClient({ region: REGION })
    const now = new Date()
    const inventory = (type: string, arn: string) => ({ id: 'x', resource_id: 'example', resource_name: null, resource_type: type, resource_arn: arn, status: 'Active', metadata: null })
    await (service as any).evaluateResource(client, resourceTypeRegistry.lambda, inventory('lambda', 'arn:aws:lambda:us-east-1:123456789012:function:example'), now, now, now, 300, 3600)
    expect(fetched).toEqual(['Invocations/Sum', 'Errors/Sum', 'Duration/Average'])
    fetched.length = 0
    await (service as any).evaluateResource(
      client,
      resourceTypeRegistry['load-balancer'],
      inventory('load-balancer', 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/example/0123456789abcdef'),
      now,
      now,
      now,
      300,
      3600
    )
    expect(fetched).toEqual(['TargetResponseTime/Average', 'RequestCount/Sum', 'HTTPCode_Target_5XX_Count/Sum', 'TargetResponseTime/Average'])
  })
})

describe('OB3 isolation and inventory coverage', () => {
  it('each organization\'s sweep queries and returns only its own resources, even with identical AWS identifiers', async () => {
    const a = await pagedOrg('iso-a', 'a-')
    const b = await pagedOrg('iso-b', 'b-')
    const sentBy: Record<string, SentQuery[]> = { [a.orgId]: [], [b.orgId]: [] }
    jest.spyOn(AWSClientFactory, 'createClients').mockImplementation(async (orgId: string) =>
      pagedClients(orgId === a.orgId ? a.accountId : b.accountId, sentBy[orgId]) as any
    )

    await signInAs(a.orgId)
    const resA = await get('/observability/resources?range=1h&pageSize=100&refresh=true')
    expect(resA.body.data.resources.map((r: any) => r.name).every((n: string) => n.startsWith('a-'))).toBe(true)
    expect(resA.body.data.resources).toHaveLength(8)
    expect(sentBy[a.orgId].length).toBeGreaterThan(0)
    expect(sentBy[b.orgId]).toHaveLength(0)

    jest.restoreAllMocks()
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 42 } as any)
    jest.spyOn(AWSClientFactory, 'createClients').mockImplementation(async (orgId: string) =>
      pagedClients(orgId === a.orgId ? a.accountId : b.accountId, sentBy[orgId]) as any
    )
    await signInAs(b.orgId)
    const resB = await get('/observability/resources?range=1h&pageSize=100&refresh=true')
    expect(resB.body.data.resources.map((r: any) => r.name).every((n: string) => n.startsWith('b-'))).toBe(true)
    expect(sentBy[b.orgId].length).toBeGreaterThan(0)
  })

  it('inventory_capped follows the discovery job only: paged metrics leave it false for a clean job and true for a truncated one', async () => {
    const { orgId, accountId } = await pagedOrg('capped')
    await signInAs(orgId)
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(pagedClients(accountId, []) as any)

    await pool.query(`INSERT INTO resource_discovery_jobs (organization_id, status, completed_at, warnings) VALUES ($1, 'completed', NOW(), '[]'::jsonb)`, [orgId])
    const clean = await get('/observability/resources?range=1h&pageSize=100&refresh=true')
    expect(clean.body.data).toMatchObject({ collection: 'complete', inventory_capped: false, inventory_capped_reasons: [] })

    await pool.query(
      `INSERT INTO resource_discovery_jobs (organization_id, status, completed_at, warnings) VALUES ($1, 'completed', NOW(), '["discovery_listing_truncated"]'::jsonb)`,
      [orgId]
    )
    const truncated = await get('/observability/resources?range=1h&pageSize=100&refresh=true')
    expect(truncated.body.data).toMatchObject({ collection: 'complete', inventory_capped: true, inventory_capped_reasons: ['discovery_listing_truncated'] })
  })
})
