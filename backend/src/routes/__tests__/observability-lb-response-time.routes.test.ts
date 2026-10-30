/**
 * O3b through the real sweep: GET /api/observability/resources?lb_response_time=1.
 * - without the parameter the response has no lb_response_time block, and the request
 *   total ("Requests") appears only in the table block's rows, never in resources[];
 * - the block reads the series the sweep already fetched: the same GetMetricData
 *   queries are sent with and without it, and its window and period are exactly the
 *   ones the latency query used;
 * - one load balancer is charted (most requests among those with response-time data);
 *   a Network Load Balancer is never counted or charted; a gap is never filled;
 * - failed queries give a failed block with no checked_at; the 45 s sweep cache is
 *   shared per organization and range only;
 * - no plan gate: a free organization gets the block (no 402).
 * Placeholders only.
 */
import express from 'express'
import http from 'http'
import { Pool } from 'pg'
import observabilityResourcesRoutes from '../observability-resources.routes'
import { authService } from '../../services/auth.service'
import { AWSClientFactory } from '../../services/aws-client-factory.service'
import awsCostService from '../../services/aws-cost.service'
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

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/observability', observabilityResourcesRoutes)
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
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'O3b Route User') RETURNING id`,
    [`o3b-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`]
  )
  createdUserIds.push(rows[0].id)
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active) VALUES ($1, $2, 'viewer', NOW(), true)`,
    [orgId, rows[0].id]
  )
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: rows[0].id,
    email: 'o3b-route@example.com',
    organizationId: orgId,
    role: 'viewer',
    type: 'access',
  } as any)
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer test-token' } })
  return { status: res.status, body: await res.json() }
}

const P1 = new Date('2026-10-30T13:00:00.000Z')
const P2 = new Date('2026-10-30T13:05:00.000Z')
const P4 = new Date('2026-10-30T13:15:00.000Z')

type Answer = { status?: 'Complete' | 'Forbidden' | 'InternalError' | 'PartialData'; points?: Array<[Date, number]> }
/** dimension value -> metric name -> answer. A metric not listed completes with no datapoints. */
type Series = Record<string, Record<string, Answer>>

interface Sent {
  metricName: string
  dimension: string
  stat: string
  period: number
  startTime: number
  endTime: number
}

function recordingCloudWatch(series: Series, sent: Sent[]) {
  return {
    send: async (command: any) => {
      if (command.constructor.name !== 'GetMetricDataCommand') throw new Error(`unexpected ${command.constructor.name}`)
      const queries = command.input.MetricDataQueries as any[]
      return {
        MetricDataResults: queries.map((q) => {
          const metric = q.MetricStat.Metric
          const dimension = metric.Dimensions?.[0]?.Value
          sent.push({
            metricName: metric.MetricName,
            dimension,
            stat: q.MetricStat.Stat,
            period: q.MetricStat.Period,
            startTime: command.input.StartTime.getTime(),
            endTime: command.input.EndTime.getTime(),
          })
          const answer = series[dimension]?.[metric.MetricName]
          const points = answer?.points ?? []
          return { Id: q.Id, StatusCode: answer?.status ?? 'Complete', Timestamps: points.map(([t]) => t), Values: points.map(([, v]) => v) }
        }),
      }
    },
  }
}

function clientsFor(accountId: string, series: Series, sent: Sent[]) {
  const cloudWatch = recordingCloudWatch(series, sent)
  return { ...fakeClients({ metrics: {}, accountId }), cloudWatch, getCloudWatchClientForRegion: () => cloudWatch }
}

const BUSY_DIM = 'app/busy-alb/0123456789abcdef'
const QUIET_DIM = 'app/quiet-alb/0123456789abcdef'
const DOWN_DIM = 'app/down-alb/0123456789abcdef'

function lbFleet(accountId: string, prefix = ''): FleetResource[] {
  const lb = (name: string, type: string, kind: 'app' | 'net') => ({
    name: `${prefix}${name}`,
    type: 'load-balancer',
    resourceId: name,
    arn: `arn:aws:elasticloadbalancing:${REGION}:${accountId}:loadbalancer/${kind}/${name}/0123456789abcdef`,
    status: 'active',
    metadata: { type },
  })
  return [
    lb('busy-alb', 'application', 'app'),
    lb('quiet-alb', 'application', 'app'),
    lb('down-alb', 'application', 'app'),
    lb('edge-nlb', 'network', 'net'),
    { name: `${prefix}web`, type: 'ec2', resourceId: 'i-1234567890abcdef0', arn: `arn:aws:ec2:${REGION}:${accountId}:instance/i-1234567890abcdef0`, status: 'running' },
  ]
}

// busy-alb: 3 latency points with the 13:10 slot missing; 9,000 requests; 30 5xx.
// quiet-alb: 1 latency point; 120 requests. down-alb: latency query denied, RequestCount empty.
const SERIES: Series = {
  [BUSY_DIM]: {
    TargetResponseTime: { points: [[P4, 0.15], [P1, 0.1], [P2, 0.12]] },
    RequestCount: { points: [[P1, 3000], [P2, 3000], [P4, 3000]] },
    HTTPCode_Target_5XX_Count: { points: [[P2, 20]] },
    HTTPCode_ELB_5XX_Count: { points: [[P4, 10]] },
  },
  [QUIET_DIM]: { TargetResponseTime: { points: [[P1, 0.2]] }, RequestCount: { points: [[P1, 120]] } },
  [DOWN_DIM]: { TargetResponseTime: { status: 'Forbidden' } },
  'i-1234567890abcdef0': { StatusCheckFailed: { points: [[P1, 0]] }, CPUUtilization: { points: [[P1, 5]] } },
}

async function lbOrg(label: string, prefix = '') {
  const fleet = await insertFleetOrg(pool, label, (accountId) => lbFleet(accountId, prefix))
  createdOrgIds.push(fleet.orgId)
  return fleet
}

const metricLabels = (row: any) => row.metrics.map((m: any) => m.label)

describe('opt-in: without lb_response_time=1 nothing changes', () => {
  it.each(['', '&lb_response_time=0', '&lb_response_time=true', '&lb_response_time=1x'])('"%s" → no block; Requests never in resources[]', async (param) => {
    const { orgId, accountId } = await lbOrg('optin')
    await signInAs(orgId)
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clientsFor(accountId, SERIES, []) as any)

    const { status, body } = await get(`/observability/resources?range=1h&pageSize=100${param}`)
    expect(status).toBe(200)
    expect(body.data.status).toBe('ok')
    expect('lb_response_time' in body.data).toBe(false)
    expect('table' in body.data).toBe(false)
    for (const r of body.data.resources) expect(metricLabels(r)).not.toContain('Requests')
  })
})

describe('the block, from the sweep that already ran', () => {
  it('charts the busiest ALB with response-time data; NLB never counted; gaps not filled; Requests only in table rows', async () => {
    const { orgId, accountId } = await lbOrg('block')
    await signInAs(orgId)
    const sent: Sent[] = []
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clientsFor(accountId, SERIES, sent) as any)

    const { status, body } = await get('/observability/resources?range=1h&pageSize=100&table=1&lb_response_time=1')
    expect(status).toBe(200)
    const block = body.data.lb_response_time
    expect(block).toMatchObject({
      range: '1h',
      statistic: 'Average',
      unit: 'ms',
      period_seconds: 300,
      eligible_count: 3,
      selection_complete: true,
      collection: 'partial',
      checked_at: null,
      state: 'ok',
    })
    expect(block.charted).toEqual({
      resource_id: 'busy-alb',
      name: 'busy-alb',
      value_ms: 123,
      points: [
        { t: P1.toISOString(), ms: 100 },
        { t: P2.toISOString(), ms: 120 },
        { t: P4.toISOString(), ms: 150 },
      ],
    })

    // The block's window and period are exactly the latency query's.
    const latency = sent.filter((q) => q.metricName === 'TargetResponseTime' && q.dimension === BUSY_DIM)
    const current = latency.find((q) => q.endTime === Math.max(...latency.map((l) => l.endTime)))!
    expect(Date.parse(block.window_start)).toBe(current.startTime)
    expect(Date.parse(block.window_end)).toBe(current.endTime)
    expect(block.period_seconds).toBe(current.period)
    expect(current.stat).toBe('Average')
    // Never a query for the NLB.
    expect(sent.some((q) => q.dimension.startsWith('net/'))).toBe(false)

    // Requests: in the table block's ALB rows only (empty RequestCount = 0; a failed one has none).
    const tableRow = (name: string) => body.data.table.rows.find((r: any) => r.name === name)
    expect(tableRow('busy-alb').metrics).toContainEqual({ label: 'Requests', value: 9000, statistic: 'Sum', window: '1h' })
    expect(tableRow('quiet-alb').metrics).toContainEqual({ label: 'Requests', value: 120, statistic: 'Sum', window: '1h' })
    expect(tableRow('down-alb').metrics).toContainEqual({ label: 'Requests', value: 0, statistic: 'Sum', window: '1h' })
    expect(metricLabels(tableRow('edge-nlb'))).not.toContain('Requests')
    expect(metricLabels(tableRow('web'))).not.toContain('Requests')
    for (const r of body.data.resources) expect(metricLabels(r)).not.toContain('Requests')
    // The rest of the table row is the resources[] row unchanged.
    const plain = body.data.resources.find((r: any) => r.name === 'busy-alb')
    expect({ ...tableRow('busy-alb'), metrics: tableRow('busy-alb').metrics.filter((m: any) => m.label !== 'Requests') }).toEqual(plain)
    // Unchanged 5xx contract: 30 / 9,000 = 0.33%.
    expect(plain.metrics).toContainEqual({ label: '5xx rate', value: 0.33, unit: '%', statistic: 'Sum', window: '1h' })
  })

  it('sends exactly the same GetMetricData queries with and without the parameter', async () => {
    const { orgId, accountId } = await lbOrg('same-queries')
    await signInAs(orgId)
    const without: Sent[] = []
    const withIt: Sent[] = []
    const shape = (s: Sent[]) => s.map((q) => `${q.metricName}|${q.dimension}|${q.stat}|${q.period}`).sort()

    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clientsFor(accountId, SERIES, without) as any)
    await get('/observability/resources?range=3h&pageSize=1&table=1&refresh=true')
    jest.restoreAllMocks()
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 42 } as any)
    await signInAs(orgId)
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clientsFor(accountId, SERIES, withIt) as any)
    const { body } = await get('/observability/resources?range=3h&pageSize=1&table=1&lb_response_time=1&refresh=true')

    expect(body.data.lb_response_time.state).toBe('ok')
    expect(withIt.length).toBeGreaterThan(0)
    expect(shape(withIt)).toEqual(shape(without))
  })

  it('every query failed → failed block, no chart, no checked_at', async () => {
    const { orgId, accountId } = await lbOrg('all-failed')
    await signInAs(orgId)
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(
      { ...fakeClients({ metrics: {}, accountId, getMetricDataError: Object.assign(new Error('boom'), { name: 'InternalServiceError' }) }) } as any
    )

    const { body } = await get('/observability/resources?range=1h&pageSize=1&lb_response_time=1')
    expect(body.data.lb_response_time).toMatchObject({ state: 'failed', charted: null, eligible_count: 3, collection: 'partial', checked_at: null, selection_complete: false })
  })

  it('every query complete → checked_at is set (and only then)', async () => {
    const { orgId, accountId } = await lbOrg('all-complete')
    await signInAs(orgId)
    const series: Series = { ...SERIES, [DOWN_DIM]: { TargetResponseTime: { points: [[P1, 0.3]] }, RequestCount: { points: [[P1, 5]] } } }
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clientsFor(accountId, series, []) as any)

    const { body } = await get('/observability/resources?range=1h&pageSize=1&lb_response_time=1')
    expect(body.data.lb_response_time.collection).toBe('complete')
    expect(typeof body.data.lb_response_time.checked_at).toBe('string')
    expect(body.data.lb_response_time.checked_at).toBe(body.data.lb_response_time.window_end)
  })

  it('a partial latency series (PartialData) is never charted', async () => {
    const { orgId, accountId } = await lbOrg('partial-series')
    await signInAs(orgId)
    const series: Series = {
      [BUSY_DIM]: { ...SERIES[BUSY_DIM], TargetResponseTime: { status: 'PartialData', points: [[P1, 0.1]] } },
      [QUIET_DIM]: { TargetResponseTime: { status: 'InternalError' }, RequestCount: { points: [[P1, 120]] } },
      [DOWN_DIM]: { TargetResponseTime: { status: 'Forbidden' } },
    }
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clientsFor(accountId, series, []) as any)

    const { body } = await get('/observability/resources?range=1h&pageSize=1&lb_response_time=1')
    expect(body.data.lb_response_time).toMatchObject({ state: 'failed', charted: null, collection: 'partial', checked_at: null })
  })
})

describe('the 45 s sweep cache', () => {
  it('per organization and range: a second call reuses the sweep; another org or range never shares it', async () => {
    const a = await lbOrg('cache-a', 'a-')
    const b = await lbOrg('cache-b', 'b-')
    const sentA: Sent[] = []
    const sentB: Sent[] = []
    const createClients = jest.spyOn(AWSClientFactory, 'createClients')
    createClients.mockImplementation(async (orgId: string) => (orgId === a.orgId ? clientsFor(a.accountId, SERIES, sentA) : clientsFor(b.accountId, SERIES, sentB)) as any)

    await signInAs(a.orgId)
    const first = await get('/observability/resources?range=15m&pageSize=1&lb_response_time=1')
    const afterFirst = sentA.length
    const second = await get('/observability/resources?range=15m&pageSize=1&lb_response_time=1')
    expect(sentA.length).toBe(afterFirst)
    expect(second.body.data.lb_response_time).toEqual(first.body.data.lb_response_time)
    expect(first.body.data.lb_response_time.charted.name).toBe('a-busy-alb')

    await signInAs(b.orgId)
    const other = await get('/observability/resources?range=15m&pageSize=1&lb_response_time=1')
    expect(other.body.data.lb_response_time.charted.name).toBe('b-busy-alb')
    expect(sentB.length).toBeGreaterThan(0)

    await signInAs(a.orgId)
    const day = await get('/observability/resources?range=24h&pageSize=1&lb_response_time=1')
    expect(sentA.length).toBeGreaterThan(afterFirst)
    expect(day.body.data.lb_response_time).toMatchObject({ range: '24h', period_seconds: 3600 })
    expect(first.body.data.lb_response_time).toMatchObject({ range: '15m', period_seconds: 60 })
  })
})

describe('plan access (decision 10)', () => {
  it('a free organization gets the block: no plan gate, no 402', async () => {
    const { orgId, accountId } = await lbOrg('free')
    await pool.query(`UPDATE organizations SET subscription_tier = 'free' WHERE id = $1`, [orgId])
    await signInAs(orgId)
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clientsFor(accountId, SERIES, []) as any)

    const { status, body } = await get('/observability/resources?range=1h&pageSize=1&lb_response_time=1')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.lb_response_time.state).toBe('ok')
  })
})
