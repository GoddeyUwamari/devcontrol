/**
 * GET /api/cloudwatch/metrics stays byte-identical (OB2, founder decision D4).
 *
 * The expected body, __fixtures__/cloudwatch-metrics-legacy-payload.json, was
 * captured by running this test against the code BEFORE OB2 (c42c3cc) with
 * WRITE_LEGACY_PAYLOAD=1. Without that variable the test never writes: it
 * compares the current response, run-dependent fields masked, to that file as
 * exact JSON text, so a changed value, an added or removed key, or a changed
 * key order all fail it.
 *
 * The fleet covers every resource type and state the observability contract
 * distinguishes (running, stopped, denied, outside region, outside account,
 * idle, not measured, point-in-time), including the api-gateway and s3 rows
 * OB2 starts reading, which must not appear here.
 */
import express from 'express'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { Pool } from 'pg'
import cloudwatchRoutes from '../cloudwatch.routes'
import { authService } from '../../services/auth.service'
import { AWSClientFactory } from '../../services/aws-client-factory.service'
import awsCostService from '../../services/aws-cost.service'
import { deleteFleetOrgs, fakeClients, insertFleetOrg, maskRunDependent, mixedFleet, mixedMetrics } from './observability-fleet-fixture'

const EXPECTED_FILE = path.join(__dirname, '__fixtures__', 'cloudwatch-metrics-legacy-payload.json')

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
  app.use('/api/cloudwatch', cloudwatchRoutes)
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/cloudwatch`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await deleteFleetOrgs(pool, createdOrgIds)
  if (createdUserIds.length > 0) await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
  await pool.end()
})

afterEach(() => jest.restoreAllMocks())

it('returns exactly the pre-OB2 body for a mixed fleet', async () => {
  const { orgId, accountId } = await insertFleetOrg(pool, 'legacy', mixedFleet)
  createdOrgIds.push(orgId)
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Legacy Payload User') RETURNING id`,
    [`legacy-payload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`]
  )
  createdUserIds.push(rows[0].id)
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active) VALUES ($1, $2, 'owner', NOW(), true)`,
    [orgId, rows[0].id]
  )
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: rows[0].id,
    email: 'legacy-payload@example.com',
    organizationId: orgId,
    role: 'owner',
    type: 'access',
  } as any)
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(fakeClients({ metrics: mixedMetrics(), accountId }))
  jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 42 } as any)

  const res = await fetch(`${baseUrl}/metrics?range=1h&pageSize=100`, { headers: { Authorization: 'Bearer test-token' } })
  expect(res.status).toBe(200)
  const actual = `${JSON.stringify(maskRunDependent(await res.json()), null, 2)}\n`

  if (process.env.WRITE_LEGACY_PAYLOAD === '1') {
    fs.mkdirSync(path.dirname(EXPECTED_FILE), { recursive: true })
    fs.writeFileSync(EXPECTED_FILE, actual)
  }
  expect(actual).toBe(fs.readFileSync(EXPECTED_FILE, 'utf8'))
  expect(actual).not.toContain('observability')
})
