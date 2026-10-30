/**
 * GET /api/observability/resources without table=1 stays byte-identical (O2,
 * founder decision D2).
 *
 * The expected bodies, __fixtures__/observability-resources-payload.json, were
 * captured by running this test against the code BEFORE the O2 table block
 * (ef48ae1) with WRITE_OBS_RESOURCES_PAYLOAD=1. Without that variable the test
 * never writes: it compares the current responses, run-dependent fields masked,
 * to that file as exact JSON text, so a changed value, an added or removed key,
 * or a changed key order all fail it.
 *
 * The requests include the table parameters (q, filter, page) and table values
 * other than 1: before O2 they were ignored, and without table=1 they still are.
 */
import express from 'express'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { Pool } from 'pg'
import observabilityResourcesRoutes from '../observability-resources.routes'
import { authService } from '../../services/auth.service'
import { AWSClientFactory } from '../../services/aws-client-factory.service'
import awsCostService from '../../services/aws-cost.service'
import { ensureSharedFixtureTable } from './shared-fixture-tables'
import { deleteFleetOrgs, fakeClients, insertFleetOrg, maskRunDependent, mixedFleet, mixedMetrics } from './observability-fleet-fixture'

const EXPECTED_FILE = path.join(__dirname, '__fixtures__', 'observability-resources-payload.json')

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
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/observability`
  await ensureSharedFixtureTable(pool, 'aws_accounts')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await deleteFleetOrgs(pool, createdOrgIds)
  if (createdUserIds.length > 0) await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
  await pool.end()
})

afterEach(() => jest.restoreAllMocks())

async function signInAs(orgId: string): Promise<void> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Resources Payload User') RETURNING id`,
    [`obs-payload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`]
  )
  createdUserIds.push(rows[0].id)
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active) VALUES ($1, $2, 'viewer', NOW(), true)`,
    [orgId, rows[0].id]
  )
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: rows[0].id,
    email: 'obs-payload@example.com',
    organizationId: orgId,
    role: 'viewer',
    type: 'access',
  } as any)
}

async function get(p: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${p}`, { headers: { Authorization: 'Bearer test-token' } })
  return { status: res.status, body: await res.json() }
}

/**
 * maskRunDependent, plus the cursor (it encodes a database id) and the Last seen of
 * point-in-time rows (the sweep's own time). Datapoint Last seen is the fixture's
 * fixed DATAPOINT_AT and stays.
 */
function mask(value: unknown): unknown {
  const masked = maskRunDependent(value)
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(o)) {
        if (k === 'cursor' && typeof x === 'string') out[k] = '<cursor>'
        else if (k === 'last_seen' && o.last_seen_source === 'observation' && typeof x === 'string') out[k] = '<sweep-at>'
        else out[k] = walk(x)
      }
      return out
    }
    return v
  }
  return walk(masked)
}

it('returns exactly the pre-O2 bodies when table=1 is not sent', async () => {
  const bodies: Record<string, unknown> = {}
  const record = (label: string, r: { status: number; body: any }) => {
    bodies[label] = { status: r.status, body: mask(r.body) }
  }

  // One org per scenario, so no scenario's cache or stored observations reach another.
  const okOrg = async (label: string) => {
    const fleet = await insertFleetOrg(pool, `payload-${label}`, mixedFleet)
    createdOrgIds.push(fleet.orgId)
    await signInAs(fleet.orgId)
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(fakeClients({ metrics: mixedMetrics(), accountId: fleet.accountId }))
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 42 } as any)
  }

  await okOrg('full')
  record('range=1h&pageSize=100', await get('/resources?range=1h&pageSize=100'))
  jest.restoreAllMocks()

  await okOrg('paged')
  const first = await get('/resources?pageSize=5')
  record('pageSize=5 (page 1)', first)
  record('pageSize=5 (page 2)', await get(`/resources?pageSize=5&cursor=${encodeURIComponent(first.body.data.pagination.cursor)}`))
  jest.restoreAllMocks()

  await okOrg('week')
  record('range=7d', await get('/resources?range=7d'))
  jest.restoreAllMocks()

  await okOrg('ignored')
  record('q=web&filter=ec2&page=2 (no table)', await get('/resources?range=1h&q=web&filter=ec2&page=2'))
  record('table=0&q=web', await get('/resources?range=1h&table=0&q=web'))
  record('table=true&filter=bogus&page=0', await get('/resources?range=1h&table=true&filter=bogus&page=0'))
  jest.restoreAllMocks()

  await okOrg('failed')
  jest.spyOn(AWSClientFactory, 'createClients').mockRejectedValue(new Error('AWS_NOT_CONNECTED: org has not connected an AWS account'))
  record('failed', await get('/resources?range=1h&q=web'))
  jest.restoreAllMocks()

  const { rows } = await pool.query(`INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`, [
    `obs-payload-none-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  ])
  createdOrgIds.push(rows[0].id)
  await signInAs(rows[0].id)
  record('not_connected', await get('/resources?range=1h&filter=ec2'))
  record('invalid cursor', await get('/resources?cursor=not-base64-json'))

  const actual = `${JSON.stringify(bodies, null, 2)}\n`
  if (process.env.WRITE_OBS_RESOURCES_PAYLOAD === '1') {
    fs.mkdirSync(path.dirname(EXPECTED_FILE), { recursive: true })
    fs.writeFileSync(EXPECTED_FILE, actual)
  }
  expect(actual).toBe(fs.readFileSync(EXPECTED_FILE, 'utf8'))
  expect(actual).not.toContain('"table"')
})
