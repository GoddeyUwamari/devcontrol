/**
 * GET /api/ai-insights/preview-weekly-summary under row level security
 * (WE-3a, audit P3), against a real database. All data is synthetic.
 *
 * The app's pool is replaced by one whose sessions run as a non-superuser,
 * non-BYPASSRLS role, so aws_resources' and deployments' tenant policies
 * apply: a read sees rows only through a connection tagged for their
 * organization. Authentication is stubbed (role and org from test headers);
 * Cost Explorer is stubbed to fail.
 *
 *   1. The preview's facts show the caller's own org's deployments (this
 *      week's counts and whether any was ever recorded), and nothing of
 *      another org's. (The inventory estimate this used to compare was
 *      dropped from the email with the executive brief, founder F4.)
 *   2. The preview and the scheduled send's read agree.
 *   3. The repository's own fallback (no client passed) reads under the
 *      org's tag too, never on the bare pool.
 *   4. Controls: an untagged read sees nothing, and a connection tagged for
 *      the other org sees nothing of this one.
 *   5. The still-detected read (getHiddenFindings, via the facts builder;
 *      brief review L-4): org B's resolved findings that the latest analysis
 *      found again never appear in org A's facts, and the reverse.
 */
jest.mock('../../config/database', () => {
  const actual = jest.requireActual('../../config/database');
  const { Pool } = jest.requireActual('pg');
  const role = `we3_reader_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const readerPool = actual.installTenantTagReset(new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 6,
    options: `-c role=${role}`,
  }));
  return { ...actual, pool: readerPool, mockReader: { role, pool: readerPool } };
});

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', organizationId: req.headers['x-test-org'], role: req.headers['x-test-role'] };
    next();
  },
}));

jest.mock('../../services/aws-cost.service', () => ({
  ...jest.requireActual('../../services/aws-cost.service'),
  __esModule: true,
  default: {
    fetchCostTrend: jest.fn(async () => { throw new Error('AccessDenied: synthetic'); }),
    getCostTrendFetchedAt: jest.fn(async () => null),
  },
}));

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { Pool, PoolClient } from 'pg';
import * as database from '../../config/database';
import aiInsightsRoutes from '../ai-insights.routes';
import { WeeklySummaryRepository, weeklySummaryPeriod } from '../../repositories/weekly-summary.repository';
import type { WeeklyFacts } from '../../services/weekly-brief/facts';
import { lowActivityMetadata } from '../../services/__tests__/helpers/low-activity-fixture';

const { role: READER_ROLE, pool: readerPool } = (database as unknown as { mockReader: { role: string; pool: Pool } }).mockReader;

const admin = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const SUFFIX = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3);

let server: http.Server;
let baseUrl: string;
let A: string;
let B: string;

async function insertOrg(label: string): Promise<string> {
  return (await admin.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $1, $1, 'free', 'free') RETURNING id::text AS id`,
    [`we3-${label}-${SUFFIX}`]
  )).rows[0].id;
}

async function resources(orgId: string, costs: number[]) {
  for (const [i, cost] of costs.entries()) {
    await admin.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, estimated_monthly_cost)
       VALUES ($1, $2, $3, 'ec2', 'us-east-1', 'active', $4)`,
      [orgId, `arn:aws:test:::we3-${SUFFIX}-${orgId}-${i}`, `we3-${SUFFIX}-${i}`, cost]
    );
  }
}

const IDLE = 'Idle Instance';
const stillName = (label: string, i: number) => `we3-still-${label}-${SUFFIX}-${i}`;

/** `count` resolved Idle Instance findings that a completed analysis after the decision detected again. */
async function stillDetected(orgId: string, label: string, count: number) {
  const run = (await admin.query(
    `INSERT INTO cost_analysis_runs (organization_id, status, source, checks, lease_acquired_at, completed_at)
     VALUES ($1, 'completed', 'discovery', $2, NOW(), NOW()) RETURNING id`,
    [orgId, JSON.stringify([{ rule_id: null, issue: IDLE, outcome: 'complete', detected: count, unknown: 0 }])]
  )).rows[0].id;
  for (let i = 0; i < count; i++) {
    await admin.query(
      `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, resource_name, issue, potential_savings, severity, status, aws_region, updated_at)
       VALUES ($1, $2, 'EC2', $2, $3, 12.5, 'LOW', 'RESOLVED', 'us-east-1', NOW() - INTERVAL '2 days')`,
      [orgId, stillName(label, i), IDLE]
    );
    await admin.query(
      `INSERT INTO cost_finding_detections (organization_id, resource_id, issue, run_id, outcome, observed_at, detected_at, resource_type, potential_savings, severity, metadata)
       VALUES ($1, $2, $3, $4, 'detected', NOW(), NOW(), 'EC2', 12.5, 'LOW', $5::jsonb)`,
      [orgId, stillName(label, i), IDLE, run, JSON.stringify({ ...lowActivityMetadata(), savings_basis: 'estimated: list price' })]
    );
  }
}

async function deployments(orgId: string, status: string, count: number) {
  const service = (await admin.query(
    `INSERT INTO services (name, template, owner, organization_id) VALUES ($1, 'synthetic', 'synthetic', $2) RETURNING id`,
    [`we3-svc-${SUFFIX}-${status}`, orgId]
  )).rows[0].id;
  for (let i = 0; i < count; i++) {
    await admin.query(
      `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, organization_id, deployed_at)
       VALUES ($1, 'production', 'us-east-1', $2, 'synthetic', $3, $4)`,
      [service, status, orgId, hoursAgo(5 + i)]
    );
  }
}

beforeAll(async () => {
  await admin.query(`CREATE ROLE ${READER_ROLE} NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${READER_ROLE}`);
  await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${READER_ROLE}`);

  A = await insertOrg('a');
  B = await insertOrg('b');
  await resources(A, [10, 20]);
  await resources(B, [999]);
  await deployments(A, 'success', 2);
  await deployments(B, 'failed', 5);
  await stillDetected(A, 'a', 1);
  await stillDetected(B, 'b', 2);

  const app = express();
  app.use('/api/ai-insights', aiInsightsRoutes);
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // The CI schema has no weekly-summary preference columns on users, and its
  // aws_accounts is a shared fixture table: both are read elsewhere.
  jest.spyOn(WeeklySummaryRepository.prototype, 'getRecipients').mockResolvedValue([
    { userId: 'u', email: 'owner@example.test', fullName: 'Pat Owner' },
  ]);
  jest.spyOn(WeeklySummaryRepository.prototype, 'getAwsConnection').mockResolvedValue('connected');
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  await readerPool.end();
  for (const id of [A, B].filter(Boolean)) {
    await admin.query('DELETE FROM cost_finding_detections WHERE organization_id = $1', [id]);
    await admin.query('DELETE FROM cost_recommendations WHERE organization_id = $1', [id]);
    await admin.query('DELETE FROM cost_analysis_runs WHERE organization_id = $1', [id]);
    await admin.query('DELETE FROM deployments WHERE organization_id = $1', [id]);
    await admin.query('DELETE FROM services WHERE organization_id = $1', [id]);
    await admin.query('DELETE FROM aws_resources WHERE organization_id = $1', [id]);
    await admin.query('DELETE FROM organizations WHERE id = $1', [id]);
  }
  await admin.query(`DROP OWNED BY ${READER_ROLE}`).catch(() => undefined);
  await admin.query(`DROP ROLE IF EXISTS ${READER_ROLE}`);
  await admin.end();
});

async function preview(org: string): Promise<{ facts: WeeklyFacts }> {
  const res = await fetch(`${baseUrl}/api/ai-insights/preview-weekly-summary`, {
    headers: { 'x-test-org': org, 'x-test-role': 'owner' },
  });
  expect(res.status).toBe(200);
  return res.json();
}

/** What the facts carry from the RLS-protected deployments table. */
const tenantRead = (facts: WeeklyFacts) => (facts.delivery.state === 'available'
  ? { count: facts.delivery.count, failed: facts.delivery.failed, finished: facts.delivery.finished, everRecorded: facts.delivery.everRecorded }
  : facts.delivery.state);

const A_ROWS = { count: 2, failed: 0, finished: 2, everRecorded: true };
const B_ROWS = { count: 5, failed: 5, finished: 5, everRecorded: true };

describe('preview-weekly-summary reads under the caller org tenant context (WE-3a)', () => {
  it('control: the test role is subject to row level security -- an untagged read sees none of the rows', async () => {
    const { rows } = await readerPool.query(
      `SELECT current_user AS who, (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS exempt,
              (SELECT COUNT(*)::int FROM aws_resources WHERE organization_id = $1) AS resources,
              (SELECT COUNT(*)::int FROM deployments WHERE organization_id = $1) AS deployments`,
      [A]
    );
    expect(rows[0]).toEqual({ who: READER_ROLE, exempt: false, resources: 0, deployments: 0 });
    const asAdmin = await admin.query('SELECT COUNT(*)::int AS n FROM aws_resources WHERE organization_id = $1', [A]);
    expect(asAdmin.rows[0].n).toBe(2);
  });

  it("each owner's preview shows their own org's deployments, and nothing of the other org's", async () => {
    const a = await preview(A);
    const b = await preview(B);
    expect(tenantRead(a.facts)).toEqual(A_ROWS);
    expect(tenantRead(b.facts)).toEqual(B_ROWS);
  });

  it("the preview and the scheduled send's read agree", async () => {
    const previewed = tenantRead((await preview(A)).facts);
    const repository = new WeeklySummaryRepository(readerPool);
    const sent = await repository.withOrganizationClient(A, client => repository.buildWeeklyFacts(A, new Date(), client));
    expect(tenantRead(sent)).toEqual(previewed);
    expect(previewed).toEqual(A_ROWS);
  });

  it('with no client passed, the repository still reads under the org tag -- never the bare pool', async () => {
    const repository = new WeeklySummaryRepository(readerPool);
    expect(tenantRead(await repository.buildWeeklyFacts(A, new Date()))).toEqual(A_ROWS);
    expect(tenantRead(await repository.buildWeeklyFacts(B, new Date()))).toEqual(B_ROWS);
  });

  it("control: a connection tagged for the other org sees nothing of this org's rows", async () => {
    const repository = new WeeklySummaryRepository(readerPool);
    const period = weeklySummaryPeriod(new Date());
    const crossed = await repository.withOrganizationClient(B, async (clientB: PoolClient) => ({
      dora: await repository.getWeeklyDORAMetrics(
        { organizationId: A, startDate: new Date(period.delivery.start), endDate: new Date(period.delivery.end) },
        clientB
      ),
      facts: await repository.buildWeeklyFacts(A, new Date(), clientB),
    }));
    expect(crossed.dora.deploymentCount).toBe(0);
    expect(tenantRead(crossed.facts)).toEqual({ count: 0, failed: 0, finished: 0, everRecorded: false });
  });
});

/** What the facts carry from the still-detected read (getHiddenFindings). */
const stillRead = (facts: WeeklyFacts) => (facts.savings.state === 'available'
  ? { count: facts.savings.stillDetected.count, resource: facts.savings.stillDetected.example?.resource ?? null }
  : facts.savings.state);

describe('the still-detected read stays in the caller org (brief review L-4)', () => {
  it('control: an untagged read sees none of the cost rows; the admin sees them', async () => {
    const { rows } = await readerPool.query(
      `SELECT (SELECT COUNT(*)::int FROM cost_recommendations WHERE organization_id = ANY($1)) AS decisions,
              (SELECT COUNT(*)::int FROM cost_finding_detections WHERE organization_id = ANY($1)) AS detections,
              (SELECT COUNT(*)::int FROM cost_analysis_runs WHERE organization_id = ANY($1)) AS runs`,
      [[A, B]]
    );
    expect(rows[0]).toEqual({ decisions: 0, detections: 0, runs: 0 });
    const asAdmin = await admin.query('SELECT COUNT(*)::int AS n FROM cost_recommendations WHERE organization_id = ANY($1)', [[A, B]]);
    expect(asAdmin.rows[0].n).toBe(3);
  });

  it("each org's preview counts and names only its own findings detected again", async () => {
    const a = (await preview(A)).facts;
    const b = (await preview(B)).facts;
    expect(stillRead(a)).toEqual({ count: 1, resource: stillName('a', 0) });
    expect(stillRead(b)).toEqual({ count: 2, resource: expect.stringMatching(new RegExp(`^we3-still-b-${SUFFIX}-[01]$`)) });
    expect(JSON.stringify(a)).not.toContain('we3-still-b-');
    expect(JSON.stringify(b)).not.toContain('we3-still-a-');
  });

  it("the scheduled send's facts builder, with no client and with the other org's tagged client, never sees the other org's findings", async () => {
    const repository = new WeeklySummaryRepository(readerPool);
    const plain = await repository.buildWeeklyFacts(A, new Date());
    const crossed = await repository.withOrganizationClient(B, (clientB: PoolClient) => repository.buildWeeklyFacts(A, new Date(), clientB));
    for (const facts of [plain, crossed]) {
      expect(stillRead(facts)).toEqual({ count: 1, resource: stillName('a', 0) });
      expect(JSON.stringify(facts)).not.toContain('we3-still-b-');
    }
  });
});
